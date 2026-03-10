#!/usr/bin/env bash
# Remove Decky hook scripts and hook configuration from Claude Code settings.
set -euo pipefail

DEST="$HOME/.decky/hooks"
SETTINGS="$HOME/.claude/settings.json"
HOOKS=(permission-request.sh post-tool-use.sh stop.sh notification.sh)
EVENTS=(PermissionRequest PostToolUse Stop Notification)

# --- Remove hook scripts ---
removed=0
for hook in "${HOOKS[@]}"; do
  if [ -f "$DEST/$hook" ]; then
    rm "$DEST/$hook"
    echo "  removed $DEST/$hook"
    ((removed++))
  fi
done
if [ "$removed" -eq 0 ]; then
  echo "  no hook scripts found in $DEST"
fi
# Remove directory if empty
rmdir "$DEST" 2>/dev/null && echo "  removed empty $DEST" || true

# --- Remove hook entries from settings.json ---
if [ ! -f "$SETTINGS" ]; then
  echo "No $SETTINGS found — nothing to clean up."
  echo "Done."
  exit 0
fi

if ! command -v jq &>/dev/null; then
  echo ""
  echo "WARNING: jq is not installed — cannot auto-remove hooks from settings."
  echo "Manually remove these keys from .hooks in $SETTINGS:"
  printf '  %s\n' "${EVENTS[@]}"
  echo ""
  echo "Done (scripts removed, settings NOT updated)."
  exit 0
fi

CLEANED=$(jq '
  if .hooks then
    .hooks |= del(.PermissionRequest, .PostToolUse, .Stop, .Notification)
    | if (.hooks | length) == 0 then del(.hooks) else . end
  else . end
' "$SETTINGS")
echo "$CLEANED" > "$SETTINGS"
echo ""
echo "Updated $SETTINGS (removed Decky hook entries)."
echo "Done."
