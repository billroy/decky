#!/usr/bin/env bash
# Decky — PermissionRequest hook (non-blocking, mirror only)
#
# Called by Claude Code when a permission dialog is about to appear.
# POSTs the event to the Decky bridge so the StreamDeck can show approval buttons,
# then exits 0 immediately to let Claude show its own dialog.
#
# When the user approves on the StreamDeck, the bridge dismisses Claude's dialog
# via approveOnceInClaude(). When the user approves in Claude directly, the
# PostToolUse hook notifies the bridge and the deck updates.

set -euo pipefail

BRIDGE_URL="${DECKY_BRIDGE_URL:-http://localhost:9130}"
TOKEN_FILE="$HOME/.decky/bridge-token"

if [ "${DECKY_HOOK_DEBUG:-0}" = "1" ]; then
  echo "[decky-hook] permission-request" >&2
fi

# Read JSON payload from stdin
PAYLOAD="$(cat)"
if [ -z "$(printf '%s' "$PAYLOAD" | tr -d '[:space:]')" ]; then
  PAYLOAD="{}"
fi

AUTH_ARGS=()
if [ -n "${DECKY_AUTH_TOKEN:-}" ]; then
  AUTH_ARGS+=(-H "x-decky-token: $DECKY_AUTH_TOKEN")
elif [ -f "$TOKEN_FILE" ]; then
  TOKEN_VALUE="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
  if [ -n "$TOKEN_VALUE" ]; then
    AUTH_ARGS+=(-H "x-decky-token: $TOKEN_VALUE")
  fi
fi

# POST the event to the bridge. Non-blocking — don't fail if bridge is down.
curl -sS -o /dev/null -w '' -X POST "$BRIDGE_URL/hook" \
  -H "Content-Type: application/json" \
  -H "x-decky-event: PermissionRequest" \
  -H "x-decky-approval-flow: mirror" \
  "${AUTH_ARGS[@]}" \
  -d "$PAYLOAD" 2>/dev/null || true

# Always exit 0 — let Claude show its own permission dialog.
exit 0
