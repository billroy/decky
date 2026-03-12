#!/usr/bin/env node
// @decky/setup — install Decky (StreamDeck controller for Claude Code).
//
// Usage:
//   npx @decky/setup          # hooks-only install (use from anywhere)
//   node setup.js             # full install when run from repo root
//
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// ── Node version check ──────────────────────────────────────────────────────
const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error(`ERROR: Node.js 20+ is required (found ${process.version}).`);
  process.exit(1);
}

const SCRIPT_DIR = __dirname;
const inRepo = fs.existsSync(path.join(SCRIPT_DIR, "bridge")) &&
               fs.existsSync(path.join(SCRIPT_DIR, "plugin"));

function run(cmd, cwd) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: cwd ?? SCRIPT_DIR });
  if (result.error) {
    console.error(`ERROR: could not spawn command: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`ERROR: command failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log("=== Decky Setup ===");
console.log("");

// ── Full install (from repo clone) ──────────────────────────────────────────
if (inRepo) {
  console.log("[1/4] Installing bridge dependencies...");
  run("npm install --silent", path.join(SCRIPT_DIR, "bridge"));

  console.log("[2/4] Installing plugin dependencies and building...");
  run("npm install --silent", path.join(SCRIPT_DIR, "plugin"));
  run("npm run build --silent", path.join(SCRIPT_DIR, "plugin"));

  console.log("[3/4] Installing hooks...");
  require(path.join(SCRIPT_DIR, "hooks", "install.js"));

  console.log("[4/4] Linking Stream Deck plugin...");
  const sdkCheck = spawnSync("streamdeck", ["--version"], { shell: true });
  if (sdkCheck.status === 0) {
    run("streamdeck link com.decky.controller.sdPlugin", path.join(SCRIPT_DIR, "plugin"));
    console.log("  Restart the Stream Deck app to see Decky actions.");
  } else {
    console.log("  'streamdeck' CLI not found. Install it with:");
    console.log("    npm install -g @elgato/cli");
    console.log("  Then run:");
    console.log("    cd plugin && streamdeck link com.decky.controller.sdPlugin");
  }

  console.log("");
  console.log("=== Done ===");
  console.log("");
  console.log("Start the bridge:");
  if (process.platform === "win32") {
    console.log("  start.cmd");
    console.log("");
    console.log("Or directly:");
    console.log("  cd bridge && npm run dev");
  } else {
    console.log("  ./start.sh");
    console.log("");
    console.log("Or directly:");
    console.log("  cd bridge && npm run dev");
  }
} else {
  // ── Hooks-only install (npx from outside the repo) ──────────────────────
  console.log("Installing hooks only (bridge/plugin source not found).");
  console.log("");
  require(path.join(SCRIPT_DIR, "hooks", "install.js"));

  console.log("");
  console.log("To complete the full install, clone the repo and run setup.js:");
  console.log("  git clone https://github.com/billroy/decky.git");
  console.log("  cd decky && node setup.js");
}
