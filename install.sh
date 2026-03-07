#!/usr/bin/env bash
# Decky — full install: deps, build, hooks, Claude settings, StreamDeck link.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Decky Installer ==="
echo ""

# 1. Install npm dependencies
echo "[1/5] Installing dependencies..."
(cd "$ROOT/bridge" && npm install --silent)
(cd "$ROOT/plugin" && npm install --silent)
echo "  done."

# 2. Build plugin
echo "[2/5] Building plugin..."
(cd "$ROOT/plugin" && npm run build --silent)
echo "  done."

# 3. Install hook scripts
echo "[3/5] Installing hook scripts to ~/.decky/hooks/ ..."
DEST="$HOME/.decky/hooks"
mkdir -p "$DEST"
for hook in pre-tool-use.sh post-tool-use.sh stop.sh notification.sh; do
  cp "$ROOT/hooks/$hook" "$DEST/$hook"
  chmod +x "$DEST/$hook"
done
echo "  done."

# 4. Register hooks in Claude settings
echo "[4/5] Registering hooks in ~/.claude/settings.json ..."
mkdir -p "$HOME/.claude"
node -e "
const fs = require('fs');
const path = require('path');
const settingsPath = path.join(process.env.HOME, '.claude', 'settings.json');

let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}

if (!settings.hooks) settings.hooks = {};

const deckyHooks = {
  PreToolUse:    { matcher: '*', hooks: [{ type: 'command', command: '~/.decky/hooks/pre-tool-use.sh' }] },
  PostToolUse:   { matcher: '*', hooks: [{ type: 'command', command: '~/.decky/hooks/post-tool-use.sh' }] },
  Notification:  { hooks: [{ type: 'command', command: '~/.decky/hooks/notification.sh' }] },
  Stop:          { hooks: [{ type: 'command', command: '~/.decky/hooks/stop.sh' }] },
};

for (const [event, entry] of Object.entries(deckyHooks)) {
  if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
  const exists = settings.hooks[event].some(e =>
    e.hooks?.some(h => h.command?.includes('.decky/hooks/'))
  );
  if (!exists) {
    settings.hooks[event].push(entry);
    console.log('  added ' + event + ' hook');
  } else {
    console.log('  ' + event + ' hook already registered');
  }
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
console.log('  done.');
"

# 5. Link StreamDeck plugin
echo "[5/5] Linking StreamDeck plugin..."
if command -v streamdeck &>/dev/null; then
  (cd "$ROOT/plugin" && streamdeck link com.decky.controller.sdPlugin 2>/dev/null || true)
  echo "  done. Restart the Stream Deck app to see Decky actions."
else
  echo "  'streamdeck' CLI not found. Install it with: npm install -g @elgato/cli"
  echo "  Then run: cd plugin && streamdeck link com.decky.controller.sdPlugin"
fi

echo ""
echo "=== Install complete ==="
echo ""
echo "Next: run ./start.sh to start the bridge, then add Decky Slot buttons to your deck."
