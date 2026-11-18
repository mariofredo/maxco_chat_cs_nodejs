#!/usr/bin/env bash
# ============================================================================
# install.sh - Maxco Chat CS installer for the client server
# Usage:
#   sudo ./install.sh                  # MySQL is already running elsewhere
#   sudo ./install.sh --with-db        # also run MySQL from this compose file
#   sudo IMAGE_TAR=maxco-chat-cs_<VER>_linux-<arch>.tar ./install.sh
# Without IMAGE_TAR the tar matching APP_IMAGE and this server's CPU is used.
# With sudo, write IMAGE_TAR AFTER sudo: sudo drops variables written before it.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

WITH_DB=0
for arg in "$@"; do
  case "$arg" in
    --with-db) WITH_DB=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: the 'docker compose' plugin is not available."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: the docker daemon is not running / not accessible (is Docker Desktop started?)."; exit 1; }

# This server's CPU, in the naming used by the tarballs (empty = unknown: no CPU checks).
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
APP_IMAGE_TAG="${APP_IMAGE_TAG:-maxco-chat-cs:1.1.0}"
EXPECTED_VER="${APP_IMAGE_TAG#*:}"   # the version part of APP_IMAGE (text after the colon)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# Extract the image tags inside a docker load tarball (from manifest.json).
tar_tags() {
  tar -xOf "$1" manifest.json 2>/dev/null \
    | grep -o '"maxco-chat-cs:[^"]*"' | tr -d '"' | sort -u || true
}

# Load a tarball but FAIL LOUDLY if its tags do not match what compose expects.
load_tar_checked() {
  local TARFILE="$1"
  echo "==> Loading image from ${TARFILE}"
  local TAGS
  TAGS="$(tar_tags "$TARFILE" || true)"
  if [ -z "$TAGS" ] && ! tar -xOf "$TARFILE" manifest.json 2>/dev/null | grep -q '"RepoTags"'; then
    echo "ERROR: ${TARFILE} is not a valid docker image tarball (manifest.json missing or corrupt)." >&2
    exit 1
  fi
  if [ -n "$TAGS" ] && ! echo "$TAGS" | grep -qx "$APP_IMAGE_TAG"; then
    echo "ERROR: tarball ${TARFILE} contains image(s): ${TAGS:-<none>}" >&2
    echo "       but APP_IMAGE in .env expects: ${APP_IMAGE_TAG}" >&2
    echo "       -> Fix one of the two and run again (do NOT try 'docker login', this image is not public)." >&2
    exit 1
  fi
  docker load -i "$TARFILE"
}

# CPU a tarball's image was built for, read from the image config inside it.
tar_arch() {
  local CFG
  CFG="$(tar -xOf "$1" manifest.json 2>/dev/null | grep -o '"Config":"[^"]*"' | head -n1 | cut -d'"' -f4 || true)"
  [ -n "$CFG" ] || return 0
  tar -xOf "$1" "$CFG" 2>/dev/null | grep -o '"architecture":"[^"]*"' | head -n1 | cut -d'"' -f4 || true
}

# Refuse a tarball built for another CPU (it would fail with 'exec format error').
check_tar_arch() {
  local A
  A="$(tar_arch "$1")"
  if [ -n "$HOST_ARCH" ] && [ -n "$A" ] && [ "$A" != "$HOST_ARCH" ]; then
    echo "ERROR: ${1} is built for ${A}, but this server's CPU is ${HOST_ARCH}." >&2
    echo "       Use maxco-chat-cs_${EXPECTED_VER}_linux-${HOST_ARCH}.tar instead." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# 1. Pick the tarball to load.
#    IMAGE_TAR env wins > tar matching the expected version AND this server's
#    CPU > no fallback to a wrong version (that prevented "loaded 1.0.1 but
#    compose wants 1.0.2") or to another CPU's tar (exec format error).
# ---------------------------------------------------------------------------
TAR=""
OTHER_CPU_TAR=""
if [ -n "${IMAGE_TAR:-}" ]; then
  if [ ! -f "$IMAGE_TAR" ]; then
    echo "ERROR: IMAGE_TAR points to a file that does not exist: ${IMAGE_TAR}" >&2
    echo "       Files available here:" >&2
    ls -1 maxco-chat-cs_*.tar 2>/dev/null | sed 's/^/         /' >&2 || echo "         (none)" >&2
    exit 1
  fi
  check_tar_arch "$IMAGE_TAR"
  TAR="$IMAGE_TAR"
  echo "==> Using tarball from IMAGE_TAR: ${TAR}"
else
  if [ -n "${SUDO_USER:-}" ]; then
    echo "==> IMAGE_TAR not set (with sudo, write it after sudo: sudo IMAGE_TAR=... ./install.sh)."
  fi
  while IFS= read -r CANDIDATE; do
    [ -n "$CANDIDATE" ] || continue
    case "$CANDIDATE" in
      "maxco-chat-cs_${EXPECTED_VER}_linux-${HOST_ARCH:-unknown}.tar") TAR="$CANDIDATE"; break ;;
      maxco-chat-cs_${EXPECTED_VER}_linux-*.tar) [ -n "$OTHER_CPU_TAR" ] || OTHER_CPU_TAR="$CANDIDATE" ;;
    esac
  done <<EOF
$(ls -1 maxco-chat-cs_*.tar 2>/dev/null || true)
EOF
  if [ -z "$TAR" ] && [ -n "$OTHER_CPU_TAR" ] && [ -z "$HOST_ARCH" ]; then
    TAR="$OTHER_CPU_TAR"   # unknown CPU: let docker decide
  fi
  if [ -n "$TAR" ]; then
    check_tar_arch "$TAR"
    echo "==> Tarball for APP_IMAGE version ${EXPECTED_VER} and this server's CPU (${HOST_ARCH:-unknown}): ${TAR}"
  fi
fi

# The image already in the daemon counts only when it was built for this CPU;
# otherwise (e.g. the other CPU's tar was loaded earlier) it is replaced.
LOADED_ARCH="$(docker image inspect "$APP_IMAGE_TAG" --format '{{.Architecture}}' 2>/dev/null || true)"
if [ -n "$TAR" ]; then
  if [ -n "$LOADED_ARCH" ] && { [ -z "$HOST_ARCH" ] || [ "$LOADED_ARCH" = "$HOST_ARCH" ]; }; then
    echo "==> Image ${APP_IMAGE_TAG} is already present in the daemon; skipping docker load."
  else
    if [ -n "$LOADED_ARCH" ]; then
      echo "==> Image ${APP_IMAGE_TAG} in the daemon is built for ${LOADED_ARCH}, but this server is ${HOST_ARCH}; replacing it."
    fi
    load_tar_checked "$TAR"
  fi
elif [ -z "$LOADED_ARCH" ] || { [ -n "$HOST_ARCH" ] && [ "$LOADED_ARCH" != "$HOST_ARCH" ]; }; then
  if [ -n "$LOADED_ARCH" ]; then
    echo "ERROR: image ${APP_IMAGE_TAG} in the daemon is built for ${LOADED_ARCH}, but this server is ${HOST_ARCH}," >&2
    echo "       and no ${HOST_ARCH} tarball was found here." >&2
  else
    echo "ERROR: image ${APP_IMAGE_TAG} is not loaded and no matching tarball was found here." >&2
  fi
  if [ -n "$OTHER_CPU_TAR" ]; then
    echo "       ${OTHER_CPU_TAR} is for another CPU; this server needs the ${HOST_ARCH} file." >&2
  fi
  echo "       Available tarballs:" >&2
  ls -1 maxco-chat-cs_*.tar 2>/dev/null | sed 's/^/         /' >&2 || echo "         (none)" >&2
  echo "       Put the correct vendor tarball in this folder, e.g.:" >&2
  echo "       maxco-chat-cs_${EXPECTED_VER}_linux-${HOST_ARCH:-<arch>}.tar" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Prepare .env (first run only)
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  HINT=""
  [ "$WITH_DB" = "1" ] && HINT=" --with-db"
  echo "==> .env was created from .env.example."
  echo "    Fill in the MySQL credentials (MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE) first,"
  echo "    then run again: ./install.sh${HINT}"
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Housekeeping tip: list tarballs that belong to older versions
# ---------------------------------------------------------------------------
OLD_TARS="$(ls -1 maxco-chat-cs_*.tar 2>/dev/null | grep -v "_${EXPECTED_VER}_" || true)"
if [ -n "$OLD_TARS" ]; then
  echo "NOTE: these older tarballs are no longer needed - archive or remove them to avoid mixing versions:"
  echo "$OLD_TARS" | sed 's/^/         /'
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
  [ "$STATUS" = "exited" ] && { echo "ERROR: the container stopped. See: docker compose logs app"; exit 1; }
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
  echo "                  Fix with: docker compose up -d --force-recreate" >&2
fi
echo "  Health check  : curl http://127.0.0.1:${PORT:-3000}/healthz"
echo "  Logs          : docker compose logs -f app"
echo "  Socket.IO     : http://<server>:${PORT:-3000}/socket.io/"
