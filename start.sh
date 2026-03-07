#!/usr/bin/env bash
# Decky — start the bridge server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Decky bridge on http://localhost:9130 ..."
cd "$ROOT/bridge" && exec npm run dev
