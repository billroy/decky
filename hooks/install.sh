#!/usr/bin/env bash
# Install Decky hook scripts to ~/.decky/hooks/ and configure Claude Code.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.decky/hooks"
SETTINGS="$HOME/.claude/settings.local.json"

echo "Installing Decky hooks to $DEST ..."
mkdir -p "$DEST"

for hook in pre-tool-use.sh post-tool-use.sh stop.sh notification.sh; do
  cp "$SCRIPT_DIR/$hook" "$DEST/$hook"
  chmod +x "$DEST/$hook"
  echo "  installed $hook"
done

# --- Merge hooks config into ~/.claude/settings.local.json ---

HOOKS_JSON='{
  "PreToolUse": [
    { "matcher": "*", "hooks": [{ "type": "command", "command": "~/.decky/hooks/pre-tool-use.sh" }] }
  ],
  "PostToolUse": [
    { "matcher": "*", "hooks": [{ "type": "command", "command": "~/.decky/hooks/post-tool-use.sh" }] }
  ],
  "Notification": [
    { "hooks": [{ "type": "command", "command": "~/.decky/hooks/notification.sh" }] }
  ],
  "Stop": [
    { "hooks": [{ "type": "command", "command": "~/.decky/hooks/stop.sh" }] }
  ]
}'

mkdir -p "$(dirname "$SETTINGS")"

if ! command -v jq &>/dev/null; then
  echo ""
  echo "WARNING: jq is not installed — cannot auto-configure Claude Code hooks."
  echo "Install jq (brew install jq / apt install jq) and re-run, or manually add"
  echo "the following to $SETTINGS:"
  echo ""
  echo "{ \"hooks\": $HOOKS_JSON }"
  echo ""
  echo "Done (hooks installed, settings NOT updated)."
  exit 0
fi

if [ -f "$SETTINGS" ]; then
  # Merge: set .hooks, preserving all other keys
  MERGED=$(jq --argjson hooks "$HOOKS_JSON" '.hooks = $hooks' "$SETTINGS")
  echo "$MERGED" > "$SETTINGS"
  echo ""
  echo "Updated $SETTINGS (merged hooks config)."
else
  # Create new file with just the hooks config
  echo "{}" | jq --argjson hooks "$HOOKS_JSON" '.hooks = $hooks' > "$SETTINGS"
  echo ""
  echo "Created $SETTINGS with hooks config."
fi

echo "Done."
