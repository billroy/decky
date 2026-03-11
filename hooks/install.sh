#!/usr/bin/env bash
# Install Decky hook scripts to ~/.decky/hooks/ and configure Claude Code.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.decky/hooks"
SETTINGS="$HOME/.claude/settings.json"

echo "Installing Decky hooks to $DEST ..."
mkdir -p "$DEST"
chmod 0700 "$DEST"

for hook in permission-request.sh post-tool-use.sh stop.sh notification.sh; do
  cp "$SCRIPT_DIR/$hook" "$DEST/$hook"
  chmod 0700 "$DEST/$hook"
  echo "  installed $hook"
done

# --- Merge hooks config into ~/.claude/settings.json ---
# PermissionRequest hooks must be in the global settings.json to fire correctly;
# hooks defined only in settings.local.json are silently ignored for newer event types.

DECKY_HOOKS='{
  "PermissionRequest": [
    { "matcher": "*", "hooks": [{ "type": "command", "command": "~/.decky/hooks/permission-request.sh" }] }
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
  echo "the following hooks to $SETTINGS:"
  echo ""
  echo "$DECKY_HOOKS"
  echo ""
  echo "Done (hooks installed, settings NOT updated)."
  exit 0
fi

if [ -f "$SETTINGS" ]; then
  # Deep-merge decky hooks into existing hooks, preserving other hook entries
  MERGED=$(jq --argjson decky "$DECKY_HOOKS" '
    .hooks = ((.hooks // {}) * $decky)
  ' "$SETTINGS")
  echo "$MERGED" > "$SETTINGS"
  echo ""
  echo "Updated $SETTINGS (merged Decky hooks)."
else
  echo "{}" | jq --argjson decky "$DECKY_HOOKS" '.hooks = $decky' > "$SETTINGS"
  echo ""
  echo "Created $SETTINGS with Decky hooks."
fi

echo ""
echo "NOTE: Hooks are registered in ~/.claude/settings.json (global scope)."
echo "They will intercept tool-use events in ALL Claude Code sessions."
echo "This is required for PermissionRequest hooks to fire correctly."
echo ""
echo "Done."
