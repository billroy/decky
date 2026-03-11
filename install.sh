#!/usr/bin/env bash
# Decky — full install: deps, build, hooks, Claude settings, StreamDeck link.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Decky Installer ==="
echo ""

# 1. Install npm dependencies
echo "[1/4] Installing dependencies..."
(cd "$ROOT/bridge" && npm install --silent)
(cd "$ROOT/plugin" && npm install --silent)
echo "  done."

# 2. Build plugin
echo "[2/4] Building plugin..."
(cd "$ROOT/plugin" && npm run build --silent)
echo "  done."

# 3. Install hooks and register in Claude settings
echo "[3/4] Installing hooks..."
"$ROOT/hooks/install.sh"

# 4. Link StreamDeck plugin
echo "[4/4] Linking StreamDeck plugin..."
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
