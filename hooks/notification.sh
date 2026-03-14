#!/usr/bin/env bash
# Decky — Notification hook (non-blocking)
# Reads JSON from stdin and forwards to the bridge.

BRIDGE_URL="${DECKY_BRIDGE_URL:-http://localhost:9130}"
PAYLOAD="$(cat)"
if [ -z "$(printf '%s' "$PAYLOAD" | tr -d '[:space:]')" ]; then
  PAYLOAD="{}"
fi
TOKEN_FILE="$HOME/.decky/bridge-token"

AUTH_ARGS=()
if [ -n "${DECKY_AUTH_TOKEN:-}" ]; then
  AUTH_ARGS+=(-H "x-decky-token: $DECKY_AUTH_TOKEN")
elif [ -f "$TOKEN_FILE" ]; then
  TOKEN_VALUE="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
  if [ -n "$TOKEN_VALUE" ]; then
    AUTH_ARGS+=(-H "x-decky-token: $TOKEN_VALUE")
  fi
fi

curl -s -o /dev/null -X POST "$BRIDGE_URL/hook" \
  -H "Content-Type: application/json" \
  -H "x-decky-event: Notification" \
  "${AUTH_ARGS[@]}" \
  --data-raw "$PAYLOAD" 2>/dev/null || true
