#!/usr/bin/env bash
# ============================================================================
# build_release.sh — one-command release for Maxco Chat CS
#
#   ./build_release.sh [VERSION]
#
#   VERSION       image version/tag (default: next patch of the latest released
#                 version found in release/, e.g. 1.0.0 -> 1.0.1)
#   .release-skip (opsional, di root repo) daftar deploy/sql/*.sql yang TIDAK ikut
#                 dikirim (dbchanges yang ditahan); bisa juga env SKIP_SQL="..."
#
# What it does:
#   1. build linux/amd64 + linux/arm64 images via buildx (tag maxco-chat-cs:<VERSION>)
#   2. docker save each -> release/maxco-chat-cs_<VERSION>_linux-<arch>.tar
#   3. sha256 each tar
#   4. copy deploy/ + tar + checksums into fresh handover folders
#   5. zip each handover folder + sha256 the zips
#   6. print a summary + the steps the CLIENT must run (incl. manual SQL files)
#
# Source of truth for what ships: deploy/ (compose, .env.example, install.sh,
# DEPLOYMENT.md, deploy/sql/*). Nothing on the client side needs this repo.
#
# Git is NOT touched (no commit, no push) — that stays under your control.
# ============================================================================
set -euo pipefail
# Script ini tinggal di release/ -> repo adalah parent-nya.
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

VERSION="${1:-}"

# ---- 0. discover next version if not given --------------------------------
if [ -z "$VERSION" ]; then
  LATEST="$(ls -1 release/maxco-chat-cs_*_linux-amd64.tar 2>/dev/null \
    | sed -E 's#.*/maxco-chat-cs_([0-9]+\.[0-9]+\.[0-9]+)_linux-amd64.tar#\1#' \
    | sort -V | tail -1 || true)"
  if [ -n "${LATEST:-}" ]; then
    MAJOR=$(echo "$LATEST" | cut -d. -f1)
    MINOR=$(echo "$LATEST" | cut -d. -f2)
    PATCH=$(echo "$LATEST" | cut -d. -f3)
    VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
  else
    VERSION="1.0.0"
  fi
fi
echo "==> Version: $VERSION"
[ "$VERSION" = "1.0.0" ] && [ -f release/maxco-chat-cs_1.0.0_linux-amd64.tar ] &&
  { echo "ERROR: 1.0.0 already exists in release/ — pass an explicit new version." >&2; exit 1; }

# ---- preflight -------------------------------------------------------------
command -v docker >/dev/null      || { echo "ERROR: docker not installed." >&2; exit 1; }
docker info >/dev/null            || { echo "ERROR: docker daemon not running." >&2; exit 1; }
docker buildx version >/dev/null  || { echo "ERROR: buildx plugin missing." >&2; exit 1; }
[ -f dockerfile ] || [ -f Dockerfile ] || { echo "ERROR: dockerfile missing in repo root." >&2; exit 1; }
[ -f deploy/sql/01_schema.sql ]   || { echo "ERROR: deploy/sql/01_schema.sql missing." >&2; exit 1; }

NEW_SQL_FILES="$(ls -1 deploy/sql/*.sql 2>/dev/null | sed 's#.*/##' || true)"
mkdir -p release

# SKIP_SQL bisa lewat file .release-skip (satu nama file per baris, opsional) atau env var.
# File ini memudahkan 'dbchanges dibiarkan dulu' tanpa harus mengingat env var.
if [ -z "${SKIP_SQL:-}" ] && [ -f .release-skip ]; then
  SKIP_SQL="$(grep -vE '^\s*(#|$)' .release-skip | tr '\n' ' ')"
fi
if [ -n "${SKIP_SQL:-}" ]; then
  echo "==> SKIP_SQL aktif (file IDLE tidak ikut rilis): $SKIP_SQL"
fi

# Case-insensitive filesystem gotcha: 'dockerfile' and 'Dockerfile' are the same
# file on macOS (same inode). dockerfile stays lowercase because compose `build`
# and legacy habits reference it; buildx detects both spellings fine.
if [ "$(ls -id dockerfile Dockerfile 2>/dev/null | awk '{print $1}' | sort -u | wc -l | tr -d ' ')" = "2" ]; then
  echo "NOTE: dockerfile and Dockerfile are TWO different files in this repo — review both!" >&2
fi

# validate compose files (syntax only)
# NB: `env_file: .env` merujuk file client yang memang tidak ada di repo,
# jadi validasi dibuat file .env dummy supaya config parser lolos.
ENV_FOR_VALIDATION="$(mktemp)"
cp deploy/.env.example "$ENV_FOR_VALIDATION"
touch deploy/.env
docker compose --env-file "$ENV_FOR_VALIDATION" -f deploy/docker-compose.yml config -q \
  || { echo "ERROR: deploy/docker-compose.yml invalid" >&2; rm -f deploy/.env "$ENV_FOR_VALIDATION"; exit 1; }
docker compose --env-file "$ENV_FOR_VALIDATION" -f deploy/docker-compose.yml -f deploy/docker-compose.with-db.yml config -q \
  || { echo "ERROR: deploy/docker-compose.with-db.yml invalid" >&2; rm -f deploy/.env "$ENV_FOR_VALIDATION"; exit 1; }
rm -f deploy/.env "$ENV_FOR_VALIDATION"
bash -n deploy/install.sh                                          || { echo "ERROR: install.sh syntax" >&2; exit 1; }


# ---- 1. build both architectures --------------------------------------------
for ARCH in amd64 arm64; do
  echo "==> Building linux/$ARCH ..."
  docker buildx build --platform "linux/$ARCH" \
    --build-arg APP_VERSION="$VERSION" \
    -t "maxco-chat-cs:$VERSION" --load . > /tmp/buildx_$ARCH.log 2>&1 \
    || { echo "ERROR building linux/$ARCH — log:"; tail -30 /tmp/buildx_$ARCH.log; exit 1; }
  ACTUAL="$(docker image inspect maxco-chat-cs:$VERSION --format '{{.Architecture}}')"
  [ "$ACTUAL" = "$ARCH" ] || { echo "ERROR: expected $ARCH, got $ACTUAL" >&2; exit 1; }

  echo "==> Saving + sha256 (linux/$ARCH) ..."
  docker save -o "release/maxco-chat-cs_${VERSION}_linux-${ARCH}.tar" "maxco-chat-cs:$VERSION"
  (cd release && shasum -a 256 "maxco-chat-cs_${VERSION}_linux-${ARCH}.tar" \
    > "maxco-chat-cs_${VERSION}_linux-${ARCH}.tar.sha256")
  docker rmi "maxco-chat-cs:$VERSION" >/dev/null 2>&1 || true
done

# ---- 2. handover folders + zips --------------------------------------------
HANDOVER_ROOT="$(mktemp -d)"
trap 'rm -rf "$HANDOVER_ROOT"' EXIT
for ARCH in amd64 arm64; do
  D="$HANDOVER_ROOT/maxco-chat-cs_${VERSION}_${ARCH}"
  mkdir -p "$D"
  cp -R deploy/. "$D/"
  cp "release/maxco-chat-cs_${VERSION}_linux-${ARCH}.tar" \
     "release/maxco-chat-cs_${VERSION}_linux-${ARCH}.tar.sha256" "$D/"
  find "$D" -name '.DS_Store' -delete
  chmod +x "$D/install.sh"

  # Rewrite version references in the handover copy to THIS release version.
  # (deploy/.env.example, DEPLOYMENT.md, compose default: semuanya ditulis
  #  generic di repo, tapi saat di-ship menjadi dokumen versi ini.)
  bash -n "$D/install.sh" 2>/dev/null || true   # sanity no-op
  sed -i.bak   -e "s#maxco-chat-cs:[0-9][0-9.-]*#maxco-chat-cs:${VERSION}#g" \
               -e "s#maxco-chat-cs_[0-9][0-9.-]*_linux#maxco-chat-cs_${VERSION}_linux#g" \
               -e "s#maxco-chat-cs\\:1\\.0\\.0#maxco-chat-cs:${VERSION}#g" \
               "$D/.env.example" "$D/DEPLOYMENT.md" "$D/docker-compose.yml" "$D/docker-compose.with-db.yml" \
               "$D/install.sh" 2>/dev/null || true
  rm -f "$D/.env.example.bak" "$D/DEPLOYMENT.md.bak" "$D/docker-compose.yml.bak" "$D/docker-compose.with-db.yml.bak" 2>/dev/null

  # Exclude sql file yang sengaja ditahan (.release-skip / SKIP_SQL) SEBELUM zip.
  for S in ${SKIP_SQL:-}; do
    rm -f "$D/sql/$S"
    echo "==> Excluded from handover: sql/$S (SKIP_SQL)"
  done
  (cd "$HANDOVER_ROOT" && zip -qr "maxco-chat-cs_${VERSION}_${ARCH}.zip" "maxco-chat-cs_${VERSION}_${ARCH}")
  cp "$HANDOVER_ROOT/maxco-chat-cs_${VERSION}_${ARCH}.zip" release/
done
(cd release && shasum -a 256 maxco-chat-cs_${VERSION}_*.zip > maxco-chat-cs_handover-archives.sha256)

# ---- 3. product sql files: which must be run manually on the client DB -----
# Overridable via env: SKIP_SQL="07_dbchanges_202610191417.sql" ./build_release.sh
# -> file-file itu dihapus DARI handover DAN dari daftar instruksi manual.
#    (dibuat untuk dbchanges yang sengaja ditahan dan tidak ikut rilis ini)
MANUAL_SQL=""
for F in $NEW_SQL_FILES; do
  case "$F" in
    01_schema.sql|02_migrations.sql) continue ;;                  # bootstrap: auto at fresh install
  esac
  SKIP=0
  for S in ${SKIP_SQL:-}; do
    [ "$F" = "$S" ] && SKIP=1
  done
  [ "$SKIP" = "0" ] && MANUAL_SQL="$MANUAL_SQL $F"
done

# ---- 4. summary + client instructions ---------------------------------------
echo
echo "================= RELEASE BUILT ================="
( cd release && ls -lh maxco-chat-cs_${VERSION}_* )
echo
echo "Manual SQL files for EXISTING client databases (run once, in order):"
if [ -n "$MANUAL_SQL" ]; then echo "  $MANUAL_SQL" | tr ' ' '\n' | sed 's/^/   /'
else echo "  (none — schema unchanged)" ; fi
echo
echo "CLIENT UPDATE STEPS:"
cat <<EOF
  sha256sum -c maxco-chat-cs_${VERSION}_linux-<arch>.tar.sha256
  docker load -i maxco-chat-cs_${VERSION}_linux-<arch>.tar
  # if there are manual SQL files above, run them now (mysql -u <user> -p < file)
  cp .env.example /tmp/new-env-vars ; nano /tmp/new-env-vars   # review new vars
  #   -> merge missing keys into existing .env (keep current secrets!)
  sed -i 's/^APP_IMAGE=.*/APP_IMAGE=maxco-chat-cs:${VERSION}/' .env
  docker compose up -d
  curl -s http://127.0.0.1:\$(grep -E '^APP_PORT=' .env | cut -d= -f2)/healthz
EOF
echo
echo "Fresh-install client: unzip, cp .env.example .env (fill it), ./install.sh"
echo "Remember .env NEVER ships — the client owns those secrets."
echo "Handover zips are in release/ ; .sha256 beside them."
