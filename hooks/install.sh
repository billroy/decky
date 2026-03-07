#!/usr/bin/env bash
# Install Decky hook scripts to ~/.decky/hooks/ and configure Claude Code.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.decky/hooks"

echo "Installing Decky hooks to $DEST ..."
mkdir -p "$DEST"

for hook in pre-tool-use.sh post-tool-use.sh stop.sh notification.sh; do
  cp "$SCRIPT_DIR/$hook" "$DEST/$hook"
  chmod +x "$DEST/$hook"
  echo "  installed $hook"
done

echo ""
echo "Hook scripts installed. Add the following to ~/.claude/settings.local.json:"
echo ""
cat <<'JSON'
{
  "hooks": {
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
  }
}
JSON
echo ""
echo "Done."
