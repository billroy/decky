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
TIMEOUT="${DECKY_TIMEOUT:-30}"

# Read JSON payload from stdin
PAYLOAD="$(cat)"

# Ensure ~/.decky/ exists
mkdir -p "$HOME/.decky"

# Clear any stale gate file
rm -f "$GATE_FILE"

# POST the event to the bridge (fire-and-forget — don't fail if bridge is down)
curl -s -o /dev/null -X POST "$BRIDGE_URL/hook" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null || true

# Poll for the gate file
ELAPSED=0
while [ ! -f "$GATE_FILE" ]; do
  sleep 0.2
  ELAPSED=$((ELAPSED + 1))
  # Each tick is 0.2s, so 5 ticks per second
  if [ "$ELAPSED" -ge "$((TIMEOUT * 5))" ]; then
    echo "Decky: approval timed out after ${TIMEOUT}s — approving by default" >&2
    exit 0
  fi
done

# Read the result
RESULT="$(cat "$GATE_FILE")"
rm -f "$GATE_FILE"

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
    echo "Decky: unknown gate result '$RESULT' — approving by default" >&2
    exit 0
    ;;
esac
