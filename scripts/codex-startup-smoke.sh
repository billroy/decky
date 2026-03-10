#!/usr/bin/env bash
set -euo pipefail

BRIDGE_URL="${DECKY_BRIDGE_URL:-http://127.0.0.1:9130}"
TOKEN_FILE="${DECKY_TOKEN_FILE:-$HOME/.decky/bridge-token}"
TEST_CMD="${*:-curl -I https://example.com}"

if [ -n "${DECKY_AUTH_TOKEN:-}" ]; then
  TOKEN="$DECKY_AUTH_TOKEN"
elif [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(cat "$TOKEN_FILE")"
else
  echo "error: missing bridge token (set DECKY_AUTH_TOKEN or create $TOKEN_FILE)"
  exit 1
fi

api_get() {
  local path="$1"
  curl -sS -H "x-decky-token: $TOKEN" "$BRIDGE_URL$path"
}

echo "== codex startup smoke =="
echo "bridge: $BRIDGE_URL"
echo "time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo

echo "-- initial status --"
api_get "/status"
echo
echo

echo "-- initial codex provider debug --"
api_get "/debug/codex-provider"
echo
echo

echo "-- running test command --"
echo "$TEST_CMD"
set +e
bash -lc "$TEST_CMD"
CMD_EXIT=$?
set -e
echo "command_exit=$CMD_EXIT"
echo

echo "-- status after command --"
api_get "/status"
echo
echo

echo "-- approval trace (tail) --"
api_get "/debug/approval-trace?limit=30"
echo
echo

echo "-- codex provider debug after command --"
api_get "/debug/codex-provider"
echo

exit "$CMD_EXIT"
