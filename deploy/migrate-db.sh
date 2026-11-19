#!/usr/bin/env bash
# ============================================================================
# migrate-db.sh - DEPLOYMENT.md §5 Scenario A: prepare YOUR OWN MySQL / MariaDB
# for the app. Not for --with-db installs (MySQL inside this compose project).
#
#   ./migrate-db.sh                    # check, show the plan, ask, back up, apply
#   DRY_RUN=1 ./migrate-db.sh          # only check and show the plan
#   YES=1 ./migrate-db.sh              # do not ask
#   AUTO_CLOSE_MINUTES=0 ./migrate-db.sh   # also set auto-close (0 = off) at the end
#
# Connection: MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE from
# .env (variables already set in the shell win). MYSQLHOST=host.docker.internal
# is how the CONTAINER reaches MySQL on this host; from this shell that is
# 127.0.0.1. Set DB_HOST=... to connect somewhere else.
#
# Empty server   -> runs sql/01 .. sql/11 in order.
# Existing data  -> backs the database up (BACKUP_DIR, default: the folder
#                   above this one, so the dump never ships with deploy/), then
#                   runs only the files whose change is not in the database
#                   yet, then 11 (safe to repeat). 07 is never run on existing
#                   data: 11 applies the same change safely.
# A file that looks half applied stops the script before anything changes.
#
# Needs the mysql client (and mysqldump for existing data) on this machine.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

DB_NAME="maxco_chat_im"   # hard-coded in every sql/*.sql (USE `maxco_chat_im`)

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

HOST="${DB_HOST:-$(env_get MYSQLHOST)}"
[ "$HOST" = "host.docker.internal" ] && HOST="127.0.0.1"
PORT="$(env_get MYSQLPORT)"; PORT="${PORT:-3306}"
USER_="$(env_get MYSQLUSER)"
PASS="$(env_get MYSQLPASSWORD)"
DBENV="$(env_get MYSQLDATABASE)"
BACKUP_DIR="${BACKUP_DIR:-..}"

die() { echo "ERROR: $*" >&2; exit 1; }
[ -n "$HOST" ] && [ -n "$USER_" ] || die "MYSQLHOST and MYSQLUSER must be set (.env or the shell)."
[ "${DBENV:-$DB_NAME}" = "$DB_NAME" ] || die "MYSQLDATABASE is '$DBENV', but the sql/ files use '$DB_NAME'. Use the same name in both (DEPLOYMENT.md §5)."
command -v mysql >/dev/null || die "the mysql client is not installed on this machine."
ls sql/01_*.sql >/dev/null 2>&1 || die "sql/01_*.sql not found: run this script from the deploy/ folder."

# Credentials go through a private option file, never through the command line.
CNF="$(mktemp)"; chmod 600 "$CNF"; trap 'rm -f "$CNF"' EXIT
esc() { local s="${1//\\/\\\\}"; printf '%s' "${s//\"/\\\"}"; }
printf '[client]\nhost="%s"\nport=%s\nuser="%s"\npassword="%s"\n' \
  "$(esc "$HOST")" "$PORT" "$(esc "$USER_")" "$(esc "$PASS")" > "$CNF"

q() { mysql --defaults-extra-file="$CNF" -N -B -e "$1"; }

echo "==> MySQL $HOST:$PORT as $USER_, database $DB_NAME"
VERSION="$(q 'SELECT VERSION()' 2>&1)" || die "cannot connect: $VERSION"
echo "    server $VERSION"

# ---- checks (never fail: they only read information_schema) ----------------
has_table() { q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='$1'"; }
has_col()   { q "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='$1' AND COLUMN_NAME='$2'"; }
has_index() { q "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='$1' AND INDEX_NAME='$2'"; }
has_row()   { # table, where
  [ "$(has_table "$1")" = 1 ] || { echo 0; return; }
  q "SELECT COUNT(*) > 0 FROM \`$DB_NAME\`.\`$1\` WHERE $2"
}
has_system_sender() { q "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='list_messages' AND COLUMN_NAME='sender_type' AND COLUMN_TYPE LIKE '%''system''%'"; }

# Each file's changes as checks; prints "present/total".
markers() {
  case "$1" in
    02_*) echo "$(( $(has_col list_messages sender_name) + $(has_col list_chats user_name) + $(has_col list_chats admin_name) + $(has_table list_chat_category) + $(has_col list_chats category_id) ))/5" ;;
    03_*) echo "$(has_table list_user_devices)/1" ;;
    04_*) echo "$(has_col list_chats user_referrer_id)/1" ;;
    05_*) echo "$(has_row list_chat_category 'category_id = 3')/1" ;;
    06_*) echo "$(has_col list_chats user_referrer_name)/1" ;;
    07_*) echo "$(( $(has_col list_chats sales_chat_key) + $(has_index list_chats uq_list_chats_sales_chat) ))/2" ;;
    08_*) echo "$(( $(has_index list_chats idx_list_chats_user_id) + $(has_index list_messages idx_list_messages_chat_created) ))/2" ;;
    09_*) echo "$(has_table list_chat_config)/1" ;;
    10_*) echo "$(( $(has_system_sender) + $(has_row list_chat_config "config_key = 'auto_close_minutes'") ))/2" ;;
    *)    echo "?" ;;
  esac
}

FILES=()
for f in sql/*.sql; do FILES+=("$(basename "$f")"); done

EXISTING=0
if [ "$(has_table list_chats)" = 1 ] || [ "$(has_table list_messages)" = 1 ]; then EXISTING=1; fi

PLAN=()
echo
if [ "$EXISTING" = 0 ]; then
  echo "==> No app tables in $DB_NAME: new database, every file runs in order."
  PLAN=("${FILES[@]}")
  for f in "${PLAN[@]}"; do echo "    run   $f"; done
else
  echo "==> Existing database: only what is missing runs."
  [ "$(has_table list_chats)" = 1 ] && [ "$(has_table list_messages)" = 1 ] \
    || die "only one of list_chats / list_messages exists. Check the database by hand (DATABASE.md)."
  PARTIAL=0
  for f in "${FILES[@]}"; do
    case "$f" in
      01_*) echo "    done  $f"; continue ;;
      11_*) echo "    run   $f   (repair, safe to repeat)"; PLAN+=("$f"); continue ;;
    esac
    m="$(markers "$f")"
    case "$m" in
      "?") die "no check known for $f. Update migrate-db.sh before using it with this sql/ folder." ;;
    esac
    present="${m%/*}"; total="${m#*/}"
    if [ "$present" = "$total" ]; then
      echo "    done  $f"
    elif [ "${f:0:3}" = "07_" ]; then
      echo "    skip  $f   (11 applies it safely on existing data)"
    elif [ "$present" = 0 ]; then
      echo "    run   $f"; PLAN+=("$f")
    else
      echo "    HALF  $f   ($present of $total changes present)"; PARTIAL=1
    fi
  done
  [ "$PARTIAL" = 0 ] || die "a file is half applied. Nothing was changed. Finish or undo it by hand (DEPLOYMENT.md §5), then run this again."
fi

if [ "${DRY_RUN:-0}" = 1 ]; then echo; echo "DRY_RUN=1: nothing changed."; exit 0; fi
if [ "${YES:-0}" != 1 ]; then
  answer=""
  echo; read -r -p "Apply this plan to $HOST:$PORT/$DB_NAME? [y/N] " answer || true
  case "$answer" in y|Y|yes|YES) ;; *) echo "Nothing changed."; exit 0 ;; esac
fi

if [ "$EXISTING" = 1 ]; then
  command -v mysqldump >/dev/null || die "mysqldump is not installed: it is needed for the backup."
  # The dump holds every chat: readable by its owner only (a new folder too).
  [ -d "$BACKUP_DIR" ] || mkdir -m 700 -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/backup-$DB_NAME-$(date +%Y%m%d-%H%M%S).sql"
  echo; echo "==> Backup -> $BACKUP"
  ( umask 077; mysqldump --defaults-extra-file="$CNF" --single-transaction --no-tablespaces "$DB_NAME" > "$BACKUP" ) \
    || die "backup failed. Nothing was changed."
  grep -q "CREATE TABLE" "$BACKUP" || die "backup $BACKUP has no tables. Nothing was changed."
  echo "    $(grep -c 'CREATE TABLE' "$BACKUP") tables, $(wc -c < "$BACKUP" | tr -d ' ') bytes"
fi

echo
for f in "${PLAN[@]}"; do
  echo "==> $f"
  if ! OUT="$(mysql --defaults-extra-file="$CNF" < "sql/$f" 2>&1)"; then
    echo "$OUT" >&2
    die "$f failed. Files before it are applied${BACKUP:+; backup: $BACKUP}."
  fi
  if [ "${f:0:3}" = "11_" ]; then
    RESULT="$(printf '%s\n' "$OUT" | tail -n1)"
    echo "    $RESULT"
    printf '%s\n' "$RESULT" | grep -Eq '^1[[:space:]]+1[[:space:]]+(RESTRICT|NO ACTION)[[:space:]]+0$' \
      || die "11 did not end with '1 1 RESTRICT 0'${BACKUP:+; backup: $BACKUP}."
  fi
done

if [ -n "${AUTO_CLOSE_MINUTES:-}" ]; then
  [[ "$AUTO_CLOSE_MINUTES" =~ ^[0-9]+$ ]] || die "AUTO_CLOSE_MINUTES must be a whole number (0 = off)."
  q "UPDATE \`$DB_NAME\`.list_chat_config SET config_value = '$AUTO_CLOSE_MINUTES' WHERE config_key = 'auto_close_minutes'"
fi

echo
echo "==> Result"
echo "    tables:             $(q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME'") (expected 7)"
echo "    sender_type:        $(q "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='list_messages' AND COLUMN_NAME='sender_type'")"
echo "    auto_close_minutes: $(q "SELECT config_value FROM \`$DB_NAME\`.list_chat_config WHERE config_key='auto_close_minutes'") (0 = off)"
echo
echo "Next: ./install.sh (without --with-db), then ./check-endpoints.sh http://127.0.0.1:<APP_PORT>"
