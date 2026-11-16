#!/usr/bin/env bash
# ============================================================================
# install.sh - Maxco Chat CS installer / updater for the client server
#
# Layout - run every command from the install folder (the parent of deploy/):
#   deploy/    this script, docker-compose*.yml, .env, sql/
#   release/   maxco-chat-cs_<VER>_linux-<arch>.tar (+ .sha256)
#
# Usage:
#   IMAGE_TAR=release/maxco-chat-cs_<VER>_linux-<arch>.tar sudo ./deploy/install.sh
#   sudo ./deploy/install.sh             # picks the release/ tar for APP_IMAGE + this CPU
#   sudo ./deploy/install.sh --with-db   # also run MySQL from the compose files
# ============================================================================
set -euo pipefail

CALLER_DIR="$(pwd)"                               # where the command was typed
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"       # deploy/
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"       # parent of deploy/
RELEASE_DIR="$INSTALL_DIR/release"
cd "$SCRIPT_DIR"

WITH_DB=0
for arg in "$@"; do
  case "$arg" in
    --with-db) WITH_DB=1 ;;
    -h|--help) sed -n '2,13p' "$SCRIPT_DIR/$(basename "$0")"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: the 'docker compose' plugin is not available."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: the docker daemon is not running / not accessible (is Docker Desktop started?)."; exit 1; }

# This server's CPU, in the naming used by the tarballs.
case "$(uname -m)" in
  x86_64|amd64)  HOST_ARCH="amd64" ;;
  aarch64|arm64) HOST_ARCH="arm64" ;;
  *)             HOST_ARCH="" ;;
esac

# ---------------------------------------------------------------------------
# Expected image tag: read APP_IMAGE from .env when it exists, else a default.
# ---------------------------------------------------------------------------
APP_IMAGE_TAG=""
if [ -f .env ]; then
  APP_IMAGE_TAG="$(grep -E '^APP_IMAGE=' .env | head -n1 | cut -d= -f2- | tr -d ' \r' || true)"
fi
APP_IMAGE_TAG="${APP_IMAGE_TAG:-maxco-chat-cs:1.0.0}"
EXPECTED_VER="${APP_IMAGE_TAG#*:}"   # the version part of APP_IMAGE (text after the colon)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# Every vendor tarball in sight: release/ (standard layout) and deploy/ (old flat layout).
list_tars() {
  ls -1 "$RELEASE_DIR"/maxco-chat-cs_*.tar "$SCRIPT_DIR"/maxco-chat-cs_*.tar 2>/dev/null || true
}

# Path relative to the install folder, for messages.
short() { echo "${1#"$INSTALL_DIR"/}"; }

show_tars() {
  local F FOUND=0
  while IFS= read -r F; do
    [ -n "$F" ] || continue
    echo "         $(short "$F")"
    FOUND=1
  done <<EOF
$(list_tars)
EOF
  [ "$FOUND" = "1" ] || echo "         (none - put the tarball in release/)"
}

# IMAGE_TAR may be absolute, or relative to: where the command was typed, the
# install folder, deploy/ or release/. Prints the absolute path.
resolve_tar() {
  local BASE
  case "$1" in
    /*) [ -f "$1" ] && { echo "$1"; return 0; } ;;
    *)  for BASE in "$CALLER_DIR" "$INSTALL_DIR" "$SCRIPT_DIR" "$RELEASE_DIR"; do
          [ -f "$BASE/$1" ] && { echo "$BASE/$1"; return 0; }
        done ;;
  esac
  return 1
}

# Extract the image tags inside a docker load tarball (from manifest.json).
tar_tags() {
  tar -xOf "$1" manifest.json 2>/dev/null \
    | grep -o '"maxco-chat-cs:[^"]*"' | tr -d '"' | sort -u || true
}

# FAIL LOUDLY if the tarball is corrupt or its tag does not match what compose expects.
check_tar() {
  local TARFILE="$1" TAGS
  TAGS="$(tar_tags "$TARFILE" || true)"
  if [ -z "$TAGS" ] && ! tar -xOf "$TARFILE" manifest.json 2>/dev/null | grep -q '"RepoTags"'; then
    echo "ERROR: $(short "$TARFILE") is not a valid docker image tarball (manifest.json missing or corrupt)." >&2
    exit 1
  fi
  if [ -n "$TAGS" ] && ! echo "$TAGS" | grep -qx "$APP_IMAGE_TAG"; then
    echo "ERROR: tarball $(short "$TARFILE") contains image(s): ${TAGS}" >&2
    echo "       but APP_IMAGE in deploy/.env expects: ${APP_IMAGE_TAG}" >&2
    echo "       -> Updating? Set APP_IMAGE=$(echo "$TAGS" | head -n1) in deploy/.env and run again." >&2
    echo "          (do NOT try 'docker login', this image is not public)" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# 1. Pick the tarball to load.
#    IMAGE_TAR env wins > release/ tar matching the APP_IMAGE version and this
#    CPU > no fallback to a wrong version (that prevented "loaded 1.0.1 but
#    compose wants 1.0.2").
# ---------------------------------------------------------------------------
TAR=""
if [ -n "${IMAGE_TAR:-}" ]; then
  if ! TAR="$(resolve_tar "$IMAGE_TAR")"; then
    echo "ERROR: IMAGE_TAR points to a file that does not exist: ${IMAGE_TAR}" >&2
    echo "       (looked relative to ${CALLER_DIR}, ${INSTALL_DIR}, deploy/ and release/)" >&2
    echo "       Tarballs available:" >&2
    show_tars >&2
    exit 1
  fi
  echo "==> Using tarball from IMAGE_TAR: $(short "$TAR")"
else
  # No IMAGE_TAR. This is the normal case for `IMAGE_TAR=... sudo ./deploy/install.sh`:
  # the default sudo config drops variables set before `sudo`.
  OTHER_ARCH=""
  while IFS= read -r CANDIDATE; do
    [ -n "$CANDIDATE" ] || continue
    case "$(basename "$CANDIDATE")" in
      "maxco-chat-cs_${EXPECTED_VER}_linux-${HOST_ARCH:-unknown}.tar") TAR="$CANDIDATE"; break ;;
      "maxco-chat-cs_${EXPECTED_VER}_linux-"*.tar) [ -n "$OTHER_ARCH" ] || OTHER_ARCH="$CANDIDATE" ;;
    esac
  done <<EOF
$(list_tars)
EOF
  if [ -z "$TAR" ] && [ -n "$OTHER_ARCH" ]; then
    if [ -z "$HOST_ARCH" ]; then
      TAR="$OTHER_ARCH"   # unknown CPU: let docker decide
    else
      echo "WARNING: found $(short "$OTHER_ARCH") but this server is ${HOST_ARCH}; not loading it (it would fail with 'exec format error')." >&2
    fi
  fi
  if [ -n "$TAR" ]; then
    echo "==> Tarball matching APP_IMAGE version ${EXPECTED_VER}: $(short "$TAR")"
  fi
fi

if [ -n "$TAR" ]; then
  check_tar "$TAR"
  if docker image inspect "$APP_IMAGE_TAG" >/dev/null 2>&1; then
    echo "==> Image ${APP_IMAGE_TAG} is already present in the daemon; skipping docker load."
  else
    echo "==> Loading image from $(short "$TAR")"
    docker load -i "$TAR"
  fi
elif ! docker image inspect "$APP_IMAGE_TAG" >/dev/null 2>&1; then
  echo "ERROR: image ${APP_IMAGE_TAG} is not loaded and no matching tarball was found." >&2
  echo "       Expected: release/maxco-chat-cs_${EXPECTED_VER}_linux-${HOST_ARCH:-<arch>}.tar" >&2
  echo "       Tarballs available:" >&2
  show_tars >&2
  echo "       Updating? Set APP_IMAGE in deploy/.env to the new version first." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Prepare .env (first run only)
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> ${SCRIPT_DIR}/.env was created from .env.example."
  echo "    Fill in the MySQL credentials (MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE) first,"
  echo "    then run the same install command again."
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Housekeeping: other versions in release/, and a newer one not yet in use
# ---------------------------------------------------------------------------
OTHER_TARS=""
OTHER_VERS=""
while IFS= read -r F; do
  [ -n "$F" ] || continue
  V="$(basename "$F")"; V="${V#maxco-chat-cs_}"; V="${V%%_linux-*}"
  [ "$V" = "$EXPECTED_VER" ] && continue
  OTHER_TARS="${OTHER_TARS}         $(short "$F")
"
  OTHER_VERS="${OTHER_VERS} ${V}"
done <<EOF
$(list_tars)
EOF
if [ -n "$OTHER_TARS" ]; then
  echo "NOTE: tarballs of other versions (keep the previous one for rollback, archive the rest):"
  printf '%s' "$OTHER_TARS"
  # shellcheck disable=SC2086
  NEWEST="$(printf '%s\n' "$EXPECTED_VER" $OTHER_VERS | sort -V | tail -n1)"
  if [ "$NEWEST" != "$EXPECTED_VER" ]; then
    echo "WARNING: release/ has a newer version (${NEWEST}) than APP_IMAGE in deploy/.env (${EXPECTED_VER})." >&2
    echo "         To update: set APP_IMAGE=maxco-chat-cs:${NEWEST} in deploy/.env and run this again." >&2
  fi
fi

# ---------------------------------------------------------------------------
# 4. Run (compose reads the image from APP_IMAGE in .env)
# ---------------------------------------------------------------------------
# If a container is already running with a DIFFERENT image tag, force a
# recreate, otherwise compose happily reports "Running" for the stale image.
RUNNING_IMAGE_BEFORE="$(docker inspect --format '{{.Config.Image}}' maxco_chat_cs 2>/dev/null || true)"
if [ -n "$RUNNING_IMAGE_BEFORE" ] && [ "$RUNNING_IMAGE_BEFORE" != "$APP_IMAGE_TAG" ]; then
  echo "==> Detected container running old image (${RUNNING_IMAGE_BEFORE}); forcing recreate."
  if [ "$WITH_DB" = "1" ]; then
    docker compose -f docker-compose.yml -f docker-compose.with-db.yml up -d --force-recreate
  else
    docker compose up -d --force-recreate
  fi
else
  if [ "$WITH_DB" = "1" ]; then
    echo "==> Starting the application and MySQL"
    docker compose -f docker-compose.yml -f docker-compose.with-db.yml up -d
  else
    echo "==> Starting the application"
    docker compose up -d
  fi
fi

# ---------------------------------------------------------------------------
# 5. Wait until healthy, then report the ACTUAL running image
# ---------------------------------------------------------------------------
echo "==> Waiting for the application to become healthy..."
for i in $(seq 1 30); do
  STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' maxco_chat_cs 2>/dev/null || echo starting)"
  [ "$STATUS" = "healthy" ] && break
  [ "$STATUS" = "exited" ] && { echo "ERROR: the container stopped. See: (cd ${SCRIPT_DIR} && docker compose logs app)"; exit 1; }
  sleep 2
done

RUNNING_IMAGE="$(docker inspect --format '{{.Config.Image}}' maxco_chat_cs 2>/dev/null || true)"
LABEL_VERSION="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' maxco_chat_cs 2>/dev/null || echo "?")"
PORT="$(grep -E '^APP_PORT=' .env | cut -d= -f2 | tr -d ' \r' || true)"

echo
echo "Done. Status: $STATUS"
echo "  Running image : ${RUNNING_IMAGE:-<unknown>} (version label: ${LABEL_VERSION})"
if [ "$RUNNING_IMAGE" != "$APP_IMAGE_TAG" ]; then
  echo "  WARNING       : running image differs from APP_IMAGE (${APP_IMAGE_TAG})!" >&2
  echo "                  docker compose probably did not recreate the container." >&2
  echo "                  Fix with: (cd ${SCRIPT_DIR} && docker compose up -d --force-recreate)" >&2
fi
echo "  Health check  : curl http://127.0.0.1:${PORT:-3000}/healthz"
echo "  Logs          : (cd ${SCRIPT_DIR} && docker compose logs -f app)"
echo "  Socket.IO     : http://<server>:${PORT:-3000}/socket.io/"
