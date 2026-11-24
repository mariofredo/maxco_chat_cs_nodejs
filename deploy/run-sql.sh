#!/usr/bin/env bash
# ============================================================================
# run-sql.sh - DEPLOYMENT.md §5 Scenario A: run the sql/ files on your own
# MySQL / MariaDB with the mysql client of a temporary mysql:8.0 container.
# Only docker is needed on this machine, no mysql client.
#
#   ./run-sql.sh              # new database: every sql/*.sql in name order
#                             # existing database: only the files it is missing,
#                             # then 11 and 12 (safe to repeat)
#   DRY_RUN=1 ./run-sql.sh    # only show what would run
#   YES=1 ./run-sql.sh        # do not ask
#   NO_BACKUP=0 ./run-sql.sh  # back an existing database up first (default: no backup)
#   ./run-sql.sh sql/<file>.sql ...   # exactly these files, in this order
#
# Connection: MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD from .env (variables
# already set in the shell win). The container reaches MySQL the way the app
# container does. Backups go to BACKUP_DIR (default: the folder above deploy/).
# A file that looks half applied stops the script before anything changes.
# Stops at the first file that fails. MYSQL_CLIENT_IMAGE=... changes the image.
# A new sql/ file needs a check in markers() below, or an entry next to 11/12 if it is safe to repeat.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "ERROR: $*" >&2; exit 1; }

env_get() {
  local key="$1" value=""
  if [ -n "${!key:-}" ]; then printf '%s' "${!key}"; return; fi
  [ -f .env ] || return 0
  value="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- | tr -d '\r')" || true
  value="${value%%[[:space:]]#*}"                              # trailing comment
  value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
  case "$value" in \"*\") value="${value:1:${#value}-2}" ;; \'*\') value="${value:1:${#value}-2}" ;; esac
  printf '%s' "$value"
}

command -v docker >/dev/null || die "docker is not installed."
docker info >/dev/null 2>&1 || die "cannot reach docker. Is it running? Does it need sudo (sudo ./run-sql.sh)?"
# Git Bash (Windows) would turn the container paths below into C:/... paths.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

[ -f sql/01_schema.sql ] || die "sql/01_schema.sql not found: keep this script in the deploy/ folder."
DB_NAME="$(sed -n 's/^CREATE DATABASE IF NOT EXISTS `\([^`]*\)`.*/\1/p' sql/01_schema.sql | head -n1)"
[ -n "$DB_NAME" ] || die "no CREATE DATABASE line in sql/01_schema.sql."

HOST="$(env_get MYSQLHOST)"
PORT="$(env_get MYSQLPORT)"; PORT="${PORT:-3306}"
USER_="$(env_get MYSQLUSER)"
PASS="$(env_get MYSQLPASSWORD)"
DBENV="$(env_get MYSQLDATABASE)"
[ -n "$HOST" ] && [ -n "$USER_" ] || die "MYSQLHOST and MYSQLUSER must be set (.env or the shell)."
[ "${DBENV:-$DB_NAME}" = "$DB_NAME" ] \
  || die "MYSQLDATABASE is '$DBENV', but the sql/ files use '$DB_NAME'. Use the same name in both (DEPLOYMENT.md §5)."
for f in "$@"; do [ -f "$f" ] || die "file not found: $f"; done

# Reach MySQL the way the app container does (docker-compose.yml extra_hosts).
NET=(--add-host host.docker.internal:host-gateway)
case "$HOST" in
  127.0.0.1|localhost|::1)
    # Loopback = this machine. Linux: share its network. Docker Desktop has no
    # such network; there this machine is host.docker.internal.
    if docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -q "Docker Desktop"; then
      HOST=host.docker.internal
    else
      HOST=127.0.0.1; NET=(--network host)
    fi ;;
esac

IMAGE="${MYSQL_CLIENT_IMAGE:-mysql:8.0}"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Pulling $IMAGE (once; only its mysql client is used)"
  docker pull "$IMAGE" </dev/null || die "cannot pull $IMAGE. Without internet: docker load a saved $IMAGE."
fi

# One helper container for the whole run. A tmpfs replaces the image's data
# volume so nothing is left behind; removed on exit (or after 6 h at the latest).
HELPER="run-sql-$$"
docker run -d --rm --name "$HELPER" "${NET[@]}" --tmpfs /var/lib/mysql \
  --entrypoint sleep "$IMAGE" 21600 >/dev/null </dev/null || die "cannot start a $IMAGE container."
trap 'docker rm -f -v "$HELPER" >/dev/null 2>&1 </dev/null || true' EXIT

# Credentials go into a private option file inside the container, never onto a command line.
esc() { local s="${1//\\/\\\\}"; printf '%s' "${s//\"/\\\"}"; }
printf '[client]\nhost="%s"\nport=%s\nuser="%s"\npassword="%s"\nprotocol=tcp\n' \
  "$(esc "$HOST")" "$PORT" "$(esc "$USER_")" "$(esc "$PASS")" \
  | docker exec -i "$HELPER" sh -c 'umask 077; cat > /tmp/client.cnf' || die "cannot write to the $IMAGE container."
MYSQL=(docker exec -i "$HELPER" mysql --defaults-extra-file=/tmp/client.cnf)
q() { "${MYSQL[@]}" -N -B -e "$1" </dev/null; }

echo "==> MySQL $HOST:$PORT as $USER_, database $DB_NAME"
VERSION="$(q 'SELECT VERSION()' 2>&1)" || die "cannot connect: $VERSION
       From a container, MySQL must accept connections from the docker network
       (bind-address, and the user allowed from '%'), as the app container needs too."
echo "    server $VERSION"

# ---- checks (read information_schema only) ---------------------------------
has_table() { q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='$1'"; }
has_col()   { q "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='$1' AND COLUMN_NAME='$2'"; }
has_index() { q "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='$1' AND INDEX_NAME='$2'"; }
has_row()   { # table, where
  [ "$(has_table "$1")" = 1 ] || { echo 0; return; }
  q "SELECT COUNT(*) > 0 FROM \`$DB_NAME\`.\`$1\` WHERE $2"
}
has_system_sender() { q "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='list_messages' AND COLUMN_NAME='sender_type' AND COLUMN_TYPE LIKE '%''system''%'"; }

# What each file adds, as checks; prints "present/total".
markers() {
  case "$1" in
    02_*) echo "$(( $(has_col list_messages sender_name) + $(has_col list_chats user_name) + $(has_col list_chats admin_name) + $(has_table list_chat_category) + $(has_col list_chats category_id) ))/5" ;;
    03_*) echo "$(has_table list_user_devices)/1" ;;
    04_*) echo "$(has_col list_chats user_referrer_id)/1" ;;
    05_*) echo "$(has_row list_chat_category 'category_id = 3')/1" ;;
    06_*) echo "$(has_col list_chats user_referrer_name)/1" ;;
    08_*) echo "$(( $(has_index list_chats idx_list_chats_user_id) + $(has_index list_messages idx_list_messages_chat_created) ))/2" ;;
    09_*) echo "$(has_table list_chat_config)/1" ;;
    10_*) echo "$(( $(has_system_sender) + $(has_row list_chat_config "config_key = 'auto_close_minutes'") ))/2" ;;
    *)    echo "?" ;;
  esac
}

EXISTING=0
if [ "$(has_table list_chats)" = 1 ] || [ "$(has_table list_messages)" = 1 ]; then EXISTING=1; fi

# ---- plan -------------------------------------------------------------------
PLAN=()
echo
if [ $# -gt 0 ]; then
  echo "==> Files given, in this order:"
  PLAN=("$@")
  for f in "${PLAN[@]}"; do echo "    run   $f"; done
elif [ "$EXISTING" = 0 ]; then
  echo "==> No app tables in $DB_NAME: new database, every file runs in order."
  PLAN=(sql/*.sql)
  for f in "${PLAN[@]}"; do echo "    run   $f"; done
else
  echo "==> $DB_NAME already has data: only the files it is missing run."
  [ "$(has_table list_chats)" = 1 ] && [ "$(has_table list_messages)" = 1 ] \
    || die "only one of list_chats / list_messages exists. Check the database by hand (DATABASE.md)."
  PARTIAL=0
  for f in sql/*.sql; do
    b="$(basename "$f")"
    case "$b" in
      01_*) echo "    done  $f"; continue ;;
      07_*) echo "    skip  $f   (empty placeholder; 11 makes its change)"; continue ;;
      11_*|12_*) echo "    run   $f   (safe to repeat)"; PLAN+=("$f"); continue ;;
    esac
    m="$(markers "$b")"
    [ "$m" != "?" ] || die "no check known for $f. Run the files by hand: ./run-sql.sh sql/<file>.sql ..."
    present="${m%/*}"; total="${m#*/}"
    if [ "$present" = "$total" ]; then
      echo "    done  $f"
    elif [ "$present" = 0 ]; then
      echo "    run   $f"; PLAN+=("$f")
    else
      echo "    HALF  $f   ($present of $total changes present)"; PARTIAL=1
    fi
  done
  [ "$PARTIAL" = 0 ] || die "a file is half applied. Nothing was changed. Finish or undo it by hand (DATABASE.md), then run this again."
fi
NO_BACKUP="${NO_BACKUP:-1}"   # default for now: no backup; NO_BACKUP=0 makes one
if [ "$EXISTING" = 1 ]; then
  if [ "$NO_BACKUP" = 1 ]; then
    echo "    (existing data, NO backup: 11 may merge duplicate inside sales chats."
    echo "     Take your own backup first, or run with NO_BACKUP=0.)"
  else
    echo "    (existing data: $DB_NAME is backed up first)"
  fi
fi

if [ "${DRY_RUN:-0}" = 1 ]; then echo; echo "DRY_RUN=1: nothing changed."; exit 0; fi
if [ "${YES:-0}" != 1 ]; then
  answer=""
  echo; read -r -p "Run this on $HOST:$PORT/$DB_NAME? [y/N] " answer || true
  case "$answer" in y|Y|yes|YES) ;; *) echo "Nothing changed."; exit 0 ;; esac
fi

BACKUP=""
if [ "$EXISTING" = 1 ] && [ "$NO_BACKUP" != 1 ]; then
  BACKUP_DIR="${BACKUP_DIR:-..}"
  [ -d "$BACKUP_DIR" ] || die "BACKUP_DIR '$BACKUP_DIR' does not exist."
  BACKUP="$BACKUP_DIR/backup-$DB_NAME-$(date +%Y%m%d-%H%M%S).sql"
  echo
  echo "==> Backup -> $BACKUP"
  # The dump holds every chat: readable by its owner only.
  # --column-statistics=0: the MySQL 8 mysqldump also works against MariaDB.
  ( umask 077; docker exec -i "$HELPER" mysqldump --defaults-extra-file=/tmp/client.cnf \
      --single-transaction --no-tablespaces --column-statistics=0 "$DB_NAME" </dev/null > "$BACKUP" ) \
    || die "backup failed. Nothing was changed."
  grep -q "CREATE TABLE" "$BACKUP" || die "backup $BACKUP has no tables. Nothing was changed."
  echo "    $(grep -c 'CREATE TABLE' "$BACKUP") tables, $(wc -c < "$BACKUP" | tr -d ' ') bytes"
fi

echo
for f in "${PLAN[@]}"; do
  echo "==> $f"
  "${MYSQL[@]}" < "$f" \
    || die "$f failed, so the files after it did not run (the ones before it did).${BACKUP:+ Backup: $BACKUP}"
done

echo
echo "==> Tables in $DB_NAME: $(q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME'") (a complete database has 7)"
echo "    File 11 should have printed: 1  1  RESTRICT  0   (NO ACTION in place of RESTRICT is fine)"
echo "    File 12 should have printed: 1  1  0"
