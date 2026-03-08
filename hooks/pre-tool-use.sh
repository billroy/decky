#!/usr/bin/env bash
# Decky — PreToolUse hook (blocking)
#
# Called by Claude Code before a tool executes.
# 1. Reads hook JSON payload from stdin.
# 2. POSTs it to the Decky bridge so the StreamDeck can show approval buttons.
# 3. Polls ~/.decky/approval-gate until the user presses a button.
# 4. Exits 0 (approve) or 2 (deny/cancel, which blocks the tool).
#
# Timeout: defaults to 30 s — override with DECKY_TIMEOUT env var.

set -euo pipefail

BRIDGE_URL="${DECKY_BRIDGE_URL:-http://localhost:9130}"
GATE_FILE="$HOME/.decky/approval-gate"
TOKEN_FILE="$HOME/.decky/bridge-token"
TIMEOUT="${DECKY_TIMEOUT:-30}"
NONCE="$(LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 24 || true)"
if [ -z "$NONCE" ]; then
  NONCE="$(date +%s)-$$"
fi

# Read JSON payload from stdin
PAYLOAD="$(cat)"

# Ensure ~/.decky/ exists
mkdir -p "$HOME/.decky"

# Clear any stale gate file
rm -f "$GATE_FILE"

AUTH_ARGS=()
if [ -n "${DECKY_AUTH_TOKEN:-}" ]; then
  AUTH_ARGS+=(-H "x-decky-token: $DECKY_AUTH_TOKEN")
elif [ -f "$TOKEN_FILE" ]; then
  TOKEN_VALUE="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
  if [ -n "$TOKEN_VALUE" ]; then
    AUTH_ARGS+=(-H "x-decky-token: $TOKEN_VALUE")
  fi
fi

# POST the event to the bridge. If bridge is unavailable or unauthorized, fail closed.
if ! curl -s -o /dev/null -X POST "$BRIDGE_URL/hook" \
  -H "Content-Type: application/json" \
  -H "x-decky-nonce: $NONCE" \
  "${AUTH_ARGS[@]}" \
  -d "$PAYLOAD"; then
  echo '{"decision":"block","reason":"Decky bridge unavailable or unauthorized"}'
  exit 2
fi

# Poll for the gate file
ELAPSED=0
while [ ! -f "$GATE_FILE" ]; do
  sleep 0.2
  ELAPSED=$((ELAPSED + 1))
  # Each tick is 0.2s, so 5 ticks per second
  if [ "$ELAPSED" -ge "$((TIMEOUT * 5))" ]; then
    echo '{"decision":"block","reason":"Decky approval timed out"}'
    exit 2
  fi
done

# Ensure gate file has strict owner/permissions before trusting content.
FILE_UID="$(stat -f '%u' "$GATE_FILE" 2>/dev/null || echo '')"
FILE_MODE="$(stat -f '%OLp' "$GATE_FILE" 2>/dev/null || echo '')"
if [ "$FILE_UID" != "$(id -u)" ] || [ "$FILE_MODE" != "600" ]; then
  rm -f "$GATE_FILE"
  echo '{"decision":"block","reason":"Decky approval gate integrity check failed"}'
  exit 2
fi

# Read the result
RESULT="$(cat "$GATE_FILE")"
rm -f "$GATE_FILE"

EXPECTED_PREFIX="${NONCE}:"
if [ "${RESULT#"$EXPECTED_PREFIX"}" != "$RESULT" ]; then
  RESULT="${RESULT#"$EXPECTED_PREFIX"}"
else
  echo '{"decision":"block","reason":"Decky approval response nonce mismatch"}'
  exit 2
fi

case "$RESULT" in
  approve)
    exit 0
    ;;
  deny)
    # Output JSON reason on stdout so Claude Code can display it
    echo '{"decision":"block","reason":"Denied via StreamDeck"}'
    exit 2
    ;;
  cancel)
    echo '{"decision":"block","reason":"Cancelled via StreamDeck"}'
    exit 2
    ;;
  *)
    echo '{"decision":"block","reason":"Decky approval gate returned invalid value"}'
    exit 2
    ;;
esac
