#!/usr/bin/env node
// Decky — Install hook scripts to ~/.decky/hooks/ and configure Claude Code.
// Cross-platform replacement for install.sh — no jq or bash dependency.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT_DIR = __dirname;
const DEST = path.join(os.homedir(), ".decky", "hooks");
const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

const HOOKS = [
  "permission-request.js",
  "post-tool-use.js",
  "stop.js",
  "notification.js",
];

const DECKY_HOOKS = {
  PermissionRequest: [
    { matcher: "*", hooks: [{ type: "command", command: "node ~/.decky/hooks/permission-request.js" }] },
  ],
  PostToolUse: [
    { matcher: "*", hooks: [{ type: "command", command: "node ~/.decky/hooks/post-tool-use.js" }] },
  ],
  Notification: [
    { hooks: [{ type: "command", command: "node ~/.decky/hooks/notification.js" }] },
  ],
  Stop: [
    { hooks: [{ type: "command", command: "node ~/.decky/hooks/stop.js" }] },
  ],
};

// --- Install hook scripts ---

console.log(`Installing Decky hooks to ${DEST} ...`);
fs.mkdirSync(DEST, { recursive: true });
if (process.platform !== "win32") {
  fs.chmodSync(DEST, 0o700);
}

for (const hook of HOOKS) {
  const src = path.join(SCRIPT_DIR, hook);
  const dst = path.join(DEST, hook);
  fs.copyFileSync(src, dst);
  if (process.platform !== "win32") {
    fs.chmodSync(dst, 0o700);
  }
  console.log(`  installed ${hook}`);
}

// --- Merge hooks config into ~/.claude/settings.json ---
// PermissionRequest hooks must be in the global settings.json to fire correctly;
// hooks defined only in settings.local.json are silently ignored for newer event types.

fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });

let settings = {};
if (fs.existsSync(SETTINGS)) {
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS, "utf-8"));
  } catch (err) {
    console.error(`\nWARNING: Could not parse ${SETTINGS}: ${err.message}`);
    console.error("Hooks installed but settings NOT updated.");
    process.exit(0);
  }
}

// Merge Decky hook entries into existing hooks, preserving non-Decky entries.
// For each event key, append Decky's matchers to any pre-existing array so
// other tools' hooks under the same event type are not overwritten.
if (!settings.hooks || typeof settings.hooks !== "object") {
  settings.hooks = {};
}
for (const [event, deckyMatchers] of Object.entries(DECKY_HOOKS)) {
  const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  // Remove any previously-installed Decky entries (identified by command containing ".decky/hooks/")
  const nonDecky = existing.filter(
    (entry) => !(entry.hooks && entry.hooks.some((h) => h.command && h.command.includes(".decky/hooks/")))
  );
  settings.hooks[event] = [...nonDecky, ...deckyMatchers];
}

fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n", "utf-8");

if (Object.keys(settings).length === 1) {
  console.log(`\nCreated ${SETTINGS} with Decky hooks.`);
} else {
  console.log(`\nUpdated ${SETTINGS} (merged Decky hooks).`);
}

console.log("");
console.log("NOTE: Hooks are registered in ~/.claude/settings.json (global scope).");
console.log("They will intercept tool-use events in ALL Claude Code sessions.");
console.log("This is required for PermissionRequest hooks to fire correctly.");
console.log("");
console.log("Done.");
