#!/usr/bin/env bash
# Decky — Stop hook (non-blocking)
# Reads JSON from stdin and forwards to the bridge.

BRIDGE_URL="${DECKY_BRIDGE_URL:-http://localhost:9130}"
PAYLOAD="$(cat)"

curl -s -o /dev/null -X POST "$BRIDGE_URL/hook" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null || true
