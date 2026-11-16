#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-endpoints.sh — smoke test for a running Maxco Chat CS deployment
#
# Tells apart the three problems that look alike from the client app:
#   OLD BUILD  routes added in 1.0.2 answer Express "Cannot GET/POST ..." 404
#   DB ERROR   endpoints that query MySQL answer 500
#   OPEN API   REST answers without an API key (CHAT_API_KEY not set)
#
# Read-only: nothing is created. POST /api/chats/user is sent with an empty
# body, which the server rejects with 400 before it touches the database.
#
# Usage:
#   ./deploy/check-endpoints.sh                       # http://localhost:3000
#   ./deploy/check-endpoints.sh https://chat.example.com
#   CHAT_API_KEY=xxx USER_ID=123 CHAT_ID=45 ./deploy/check-endpoints.sh <url>
#
# Env (all optional):
#   CHAT_API_KEY  sent as X-API-Key; needed when the server has a key set
#   USER_ID       member id for the chat list / unread checks (default: 0)
#   CHAT_ID       chat id for the messages check (default: 0)
#
# Exit code: 0 = all checks passed, 1 = at least one FAIL, 2 = usage error.
# ---------------------------------------------------------------------------
set -u

BASE_URL="${1:-http://localhost:${PORT:-3000}}"
BASE_URL="${BASE_URL%/}"
API_KEY="${CHAT_API_KEY:-}"
USER_ID="${USER_ID:-0}"
CHAT_ID="${CHAT_ID:-0}"

command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is not installed." >&2; exit 2; }

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

FAILS=0
OLD_BUILD=0
DB_ERROR=0
NEEDS_KEY=0
OPEN_API=0
UNREACHABLE=0

# request METHOD PATH [SEND_KEY=1] [JSON_BODY]  -> sets STATUS and BODY
request() {
  local method="$1" path="$2" send_key="${3:-1}" data="${4:-}"
  local args=(-s -m 20 -o "$BODY_FILE" -w '%{http_code}' -X "$method")
  if [ "$send_key" = 1 ] && [ -n "$API_KEY" ]; then
    args+=(-H "X-API-Key: $API_KEY")
  fi
  if [ -n "$data" ]; then
    args+=(-H 'Content-Type: application/json' --data "$data")
  fi
  STATUS="$(curl "${args[@]}" "$BASE_URL$path" 2>/dev/null)" || true
  [ -n "$STATUS" ] || STATUS="000"
  BODY="$(head -c 200 "$BODY_FILE" 2>/dev/null | tr -d '\r\n')"
}

result() { printf '  [%s] %-36s %s\n' "$1" "$2" "$3"; }

# Express answers an unknown route with an HTML page "Cannot GET /path".
# A JSON 404 (e.g. "Chat not found") comes from a handler, so the route exists.
route_missing() {
  [ "$STATUS" = 404 ] && printf '%s' "$BODY" | grep -q 'Cannot '
}

# check LABEL METHOD PATH OK_STATUSES [JSON_BODY]
check() {
  local label="$1" method="$2" path="$3" ok="$4" data="${5:-}"
  request "$method" "$path" 1 "$data"

  if route_missing; then
    result FAIL "$label" "404 route missing -> old build"
    OLD_BUILD=1; FAILS=$((FAILS + 1)); return
  fi
  case " $ok " in
    *" $STATUS "*) result PASS "$label" "$STATUS"; return ;;
  esac
  case "$STATUS" in
    401) result FAIL "$label" "401 -> server wants an API key (set CHAT_API_KEY)"; NEEDS_KEY=1 ;;
    500) result FAIL "$label" "500 -> database error (see docker logs)"; DB_ERROR=1 ;;
    000) result FAIL "$label" "no response (DNS / network / TLS / timeout)"; UNREACHABLE=1 ;;
    *)   result FAIL "$label" "$STATUS $BODY" ;;
  esac
  FAILS=$((FAILS + 1))
}

echo "Maxco Chat CS endpoint check"
echo "  URL      : $BASE_URL"
if [ -n "$API_KEY" ]; then echo "  API key  : set (X-API-Key)"; else echo "  API key  : not set"; fi
echo "  USER_ID  : $USER_ID    CHAT_ID: $CHAT_ID"

echo
echo "1. Reachability"
check "GET  /healthz"                          GET  /healthz 200

echo
echo "2. Build version (routes added in 1.0.2, no database needed)"
check "GET  /api/client/presence"              GET  /api/client/presence 200
check "POST /api/chats/user (empty body)"      POST /api/chats/user 400 '{}'

echo
echo "3. Database"
check "GET  /api/chats/user/:userId"           GET  "/api/chats/user/$USER_ID" 200
check "GET  /api/chats/:chatId/messages"       GET  "/api/chats/$CHAT_ID/messages" "200 404"
check "GET  /api/client/chat/unread/:userId"   GET  "/api/client/chat/unread/$USER_ID" 200
check "GET  /api/chats/crm/config"             GET  /api/chats/crm/config 200

echo
echo "4. API key protection"
request GET "/api/chats/user/$USER_ID" 0
if [ "$STATUS" = 401 ]; then
  result PASS "REST without key" "401 (protected)"
elif [ "$STATUS" = 000 ]; then
  result FAIL "REST without key" "no response"; FAILS=$((FAILS + 1)); UNREACHABLE=1
else
  result WARN "REST without key" "$STATUS -> answers WITHOUT a key (CHAT_API_KEY not set on server)"
  OPEN_API=1
fi

echo
if [ "$FAILS" -eq 0 ] && [ "$OPEN_API" -eq 0 ]; then
  echo "RESULT: all checks passed."
  exit 0
fi

if [ "$FAILS" -gt 0 ]; then
  echo "RESULT: $FAILS check(s) failed."
else
  echo "RESULT: all checks passed, with a warning."
fi
[ "$UNREACHABLE" -eq 1 ] && echo "  - UNREACHABLE: check the URL, DNS, TLS certificate and that the container is running."
[ "$NEEDS_KEY" -eq 1 ]   && echo "  - API KEY: run again with CHAT_API_KEY=<key> (the value from deploy/.env)."
[ "$OLD_BUILD" -eq 1 ]   && echo "  - OLD BUILD: set APP_IMAGE=maxco-chat-cs:<latest> in deploy/.env and run deploy/install.sh;" \
                         && echo "    confirm with: docker inspect maxco_chat_cs --format '{{.Config.Image}}'"
[ "$DB_ERROR" -eq 1 ]    && echo "  - DATABASE: docker logs --tail 100 maxco_chat_cs  (ECONNREFUSED / ER_ACCESS_DENIED /" \
                         && echo "    ER_NO_SUCH_TABLE); fix MYSQL* in deploy/.env or run the missing sql/ migrations."
[ "$OPEN_API" -eq 1 ]    && echo "  - OPEN API: set CHAT_API_KEY in deploy/.env and share it with the app and CRM teams."
[ "$FAILS" -gt 0 ] && exit 1
exit 0
