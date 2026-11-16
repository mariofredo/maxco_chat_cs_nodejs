#!/usr/bin/env bash
# ============================================================================
# build_release.sh — one-command release for Maxco Chat CS
#
#   ./build_release.sh [VERSION]
#
#   VERSION       image version/tag (default: next patch of the latest version
#                 found in deploy/ or release/, e.g. 1.0.0 -> 1.0.1)
#   FORCE=1       allow rebuilding a VERSION whose tar already exists
#   .release-skip (opsional, di root repo) daftar deploy/sql/*.sql yang ditahan
#                 (dbchanges yang belum ikut rilis); bisa juga env SKIP_SQL="..."
#
# What it does (layout = deploy/DEPLOYMENT.md §1 — deploy/ IS the package):
#   1. move tars of OTHER versions out of deploy/ into release/ (archive)
#   2. build linux/amd64 + linux/arm64 images via buildx (tag maxco-chat-cs:<VERSION>)
#   3. docker save each -> deploy/maxco-chat-cs_<VERSION>_linux-<arch>.tar
#   4. sha256 each tar -> deploy/<tar>.sha256
#   5. print a summary + the steps the CLIENT must run (incl. manual SQL files)
#
# Hand over deploy/ with ONE of the tars (the client's CPU). Never hand over
# deploy/.env — it holds real credentials. Image tars are git-ignored.
#
# Git is NOT touched (no commit, no push) — that stays under your control.
# ============================================================================
set -euo pipefail
# Script ini tinggal di release/ -> repo adalah parent-nya.
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

VERSION="${1:-}"
OUT_DIR="deploy"
ARCHIVE_DIR="release"

# ---- 0. discover next version if not given --------------------------------
if [ -z "$VERSION" ]; then
  LATEST="$(ls -1 "$OUT_DIR"/maxco-chat-cs_*_linux-*.tar "$ARCHIVE_DIR"/maxco-chat-cs_*_linux-*.tar 2>/dev/null \
    | sed -E 's#.*/maxco-chat-cs_([0-9]+\.[0-9]+\.[0-9]+)_linux-[a-z0-9]+\.tar$#\1#' \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -Vu | tail -1 || true)"
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
if [ "${FORCE:-0}" != "1" ]; then
  for F in "$OUT_DIR/maxco-chat-cs_${VERSION}_linux-"*.tar "$ARCHIVE_DIR/maxco-chat-cs_${VERSION}_linux-"*.tar; do
    [ -e "$F" ] || continue
    echo "ERROR: $F already exists — pass a new version (or FORCE=1 to rebuild)." >&2
    exit 1
  done
fi

# ---- preflight -------------------------------------------------------------
command -v docker >/dev/null      || { echo "ERROR: docker not installed." >&2; exit 1; }
docker info >/dev/null            || { echo "ERROR: docker daemon not running." >&2; exit 1; }
docker buildx version >/dev/null  || { echo "ERROR: buildx plugin missing." >&2; exit 1; }
[ -f dockerfile ] || [ -f Dockerfile ] || { echo "ERROR: dockerfile missing in repo root." >&2; exit 1; }
[ -f "$OUT_DIR/sql/01_schema.sql" ] || { echo "ERROR: $OUT_DIR/sql/01_schema.sql missing." >&2; exit 1; }

if command -v sha256sum >/dev/null; then SHA256="sha256sum"
elif command -v shasum >/dev/null; then SHA256="shasum -a 256"
else echo "ERROR: neither sha256sum nor shasum found." >&2; exit 1; fi

NEW_SQL_FILES="$(ls -1 "$OUT_DIR"/sql/*.sql 2>/dev/null | sed 's#.*/##' || true)"
mkdir -p "$ARCHIVE_DIR"

# SKIP_SQL bisa lewat file .release-skip (satu nama file per baris, opsional) atau env var.
if [ -z "${SKIP_SQL:-}" ] && [ -f .release-skip ]; then
  SKIP_SQL="$(grep -vE '^\s*(#|$)' .release-skip | tr '\n' ' ')"
fi
if [ -n "${SKIP_SQL:-}" ]; then
  echo "==> SKIP_SQL aktif (tidak masuk daftar SQL manual): $SKIP_SQL"
fi

# Case-insensitive filesystem gotcha: 'dockerfile' and 'Dockerfile' are the same
# file on macOS/Windows (same inode). buildx detects both spellings fine.
if [ "$(ls -id dockerfile Dockerfile 2>/dev/null | awk '{print $1}' | sort -u | wc -l | tr -d ' ')" = "2" ]; then
  echo "NOTE: dockerfile and Dockerfile are TWO different files in this repo — review both!" >&2
fi

# Validate compose files (syntax only). `env_file: .env` needs a deploy/.env to
# exist; the client's real one may be there — NEVER touch it. Only a dummy we
# create ourselves is removed afterwards.
ENV_FOR_VALIDATION="$(mktemp)"
CREATED_DUMMY_ENV=0
cleanup_validation() {
  rm -f "$ENV_FOR_VALIDATION"
  [ "$CREATED_DUMMY_ENV" = "1" ] && rm -f "$OUT_DIR/.env"
  CREATED_DUMMY_ENV=0
}
trap cleanup_validation EXIT
cp "$OUT_DIR/.env.example" "$ENV_FOR_VALIDATION"
if [ ! -e "$OUT_DIR/.env" ]; then
  : > "$OUT_DIR/.env"
  CREATED_DUMMY_ENV=1
fi
docker compose --env-file "$ENV_FOR_VALIDATION" -f "$OUT_DIR/docker-compose.yml" config -q \
  || { echo "ERROR: $OUT_DIR/docker-compose.yml invalid" >&2; exit 1; }
docker compose --env-file "$ENV_FOR_VALIDATION" -f "$OUT_DIR/docker-compose.yml" -f "$OUT_DIR/docker-compose.with-db.yml" config -q \
  || { echo "ERROR: $OUT_DIR/docker-compose.with-db.yml invalid" >&2; exit 1; }
cleanup_validation
trap - EXIT
bash -n "$OUT_DIR/install.sh" || { echo "ERROR: install.sh syntax" >&2; exit 1; }

# ---- 1. archive tars of other versions (deploy/ holds ONE version only) ----
for F in "$OUT_DIR"/maxco-chat-cs_*_linux-*.tar "$OUT_DIR"/maxco-chat-cs_*_linux-*.tar.sha256; do
  [ -e "$F" ] || continue
  case "$(basename "$F")" in
    "maxco-chat-cs_${VERSION}_linux-"*) continue ;;
  esac
  if [ -e "$ARCHIVE_DIR/$(basename "$F")" ]; then
    echo "ERROR: cannot archive $F — $ARCHIVE_DIR/$(basename "$F") already exists. Resolve it by hand." >&2
    exit 1
  fi
  mv "$F" "$ARCHIVE_DIR/"
  echo "==> Archived $F -> $ARCHIVE_DIR/"
done

# ---- 2-4. build, save, checksum both architectures -------------------------
SAVE_PLATFORM_FLAG=0
docker save --help 2>/dev/null | grep -q -- '--platform' && SAVE_PLATFORM_FLAG=1

for ARCH in amd64 arm64; do
  TAR="maxco-chat-cs_${VERSION}_linux-${ARCH}.tar"
  LOG="${TMPDIR:-/tmp}/buildx_${ARCH}.log"
  echo "==> Building linux/$ARCH ..."
  docker buildx build --platform "linux/$ARCH" \
    --build-arg APP_VERSION="$VERSION" \
    -t "maxco-chat-cs:$VERSION" --load . > "$LOG" 2>&1 \
    || { echo "ERROR building linux/$ARCH — log ($LOG):"; tail -30 "$LOG"; exit 1; }
  ACTUAL="$(docker image inspect "maxco-chat-cs:$VERSION" --format '{{.Architecture}}')"
  [ "$ACTUAL" = "$ARCH" ] || { echo "ERROR: expected $ARCH, got $ACTUAL" >&2; exit 1; }

  echo "==> Saving + sha256 -> $OUT_DIR/$TAR"
  if [ "$SAVE_PLATFORM_FLAG" = "1" ]; then
    docker save --platform "linux/$ARCH" -o "$OUT_DIR/$TAR" "maxco-chat-cs:$VERSION"
  else
    docker save -o "$OUT_DIR/$TAR" "maxco-chat-cs:$VERSION"
  fi
  (cd "$OUT_DIR" && $SHA256 "$TAR" > "$TAR.sha256")
  docker rmi "maxco-chat-cs:$VERSION" >/dev/null 2>&1 || true
done

# ---- 5. product sql files: which must be run manually on the client DB -----
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

# ---- summary + client instructions -----------------------------------------
echo
echo "================= RELEASE BUILT ================="
( cd "$OUT_DIR" && ls -lh maxco-chat-cs_${VERSION}_* )
echo
EXAMPLE_IMAGE="$(grep -E '^APP_IMAGE=' "$OUT_DIR/.env.example" | head -n1 | cut -d= -f2- | tr -d ' \r' || true)"
if [ "$EXAMPLE_IMAGE" != "maxco-chat-cs:$VERSION" ]; then
  echo "WARNING: $OUT_DIR/.env.example has APP_IMAGE=$EXAMPLE_IMAGE but the image is maxco-chat-cs:$VERSION." >&2
  echo "         install.sh will refuse the tar until they match — update .env.example (and the docs) first." >&2
fi
if [ -n "${SKIP_SQL:-}" ]; then
  echo "WARNING: held SQL files are still in $OUT_DIR/sql/ — remove them from what you hand over: $SKIP_SQL" >&2
fi
echo "Manual SQL files for EXISTING client databases (run once, in order):"
if [ -n "$MANUAL_SQL" ]; then echo "  $MANUAL_SQL" | tr ' ' '\n' | sed '/^$/d' | sed 's/^/   sql\//'
else echo "  (none — schema unchanged)" ; fi
echo
echo "CLIENT STEPS (inside the handed-over deploy/ folder):"
cat <<EOF
  First install (DEPLOYMENT.md §3):
    sha256sum -c maxco-chat-cs_${VERSION}_linux-<arch>.tar.sha256
    cp .env.example .env && nano .env
    IMAGE_TAR=maxco-chat-cs_${VERSION}_linux-<arch>.tar ./install.sh

  Upgrade (DEPLOYMENT.md §10) - keep the existing .env:
    sha256sum -c maxco-chat-cs_${VERSION}_linux-<arch>.tar.sha256
    docker load -i maxco-chat-cs_${VERSION}_linux-<arch>.tar
    sed -i 's/^APP_IMAGE=.*/APP_IMAGE=maxco-chat-cs:${VERSION}/' .env
    docker compose up -d
EOF
echo
echo "Hand over deploy/ with ONE tar (+ .sha256) matching the client's CPU."
echo "NEVER hand over deploy/.env — the client owns those secrets."
