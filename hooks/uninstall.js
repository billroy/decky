#!/usr/bin/env node
// Decky — Remove hook scripts and hook configuration from Claude Code settings.
// Cross-platform replacement for uninstall.sh — no jq or bash dependency.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const DEST = path.join(os.homedir(), ".decky", "hooks");
const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

const HOOKS = [
  "permission-request.js",
  "post-tool-use.js",
  "stop.js",
  "notification.js",
];

const HOOK_EVENTS = ["PermissionRequest", "PostToolUse", "Stop", "Notification"];

// --- Remove hook scripts ---

let removed = 0;
for (const hook of HOOKS) {
  const hookPath = path.join(DEST, hook);
  if (fs.existsSync(hookPath)) {
    fs.unlinkSync(hookPath);
    console.log(`  removed ${hookPath}`);
    removed++;
  }
}
if (removed === 0) {
  console.log(`  no hook scripts found in ${DEST}`);
}

// Remove directory if empty
try {
  fs.rmdirSync(DEST);
  console.log(`  removed empty ${DEST}`);
} catch { /* not empty or already gone */ }

// --- Remove hook entries from settings.json ---

if (!fs.existsSync(SETTINGS)) {
  console.log(`No ${SETTINGS} found — nothing to clean up.`);
  console.log("Done.");
  process.exit(0);
}

let settings;
try {
  settings = JSON.parse(fs.readFileSync(SETTINGS, "utf-8"));
} catch (err) {
  console.error(`\nWARNING: Could not parse ${SETTINGS}: ${err.message}`);
  console.error("Scripts removed but settings NOT updated.");
  console.error(`Manually remove these keys from .hooks in ${SETTINGS}:`);
  for (const event of HOOK_EVENTS) console.error(`  ${event}`);
  process.exit(0);
}

if (settings.hooks && typeof settings.hooks === "object") {
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) continue;
    // Keep only non-Decky entries (those whose commands don't reference .decky/hooks/)
    settings.hooks[event] = settings.hooks[event].filter(
      (entry) => !(entry.hooks && entry.hooks.some((h) => h.command && h.command.includes(".decky/hooks/")))
    );
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  console.log(`\nUpdated ${SETTINGS} (removed Decky hook entries).`);
}

try {
  execSync("claude mcp remove decky", { stdio: "pipe" });
  console.log("Removed Decky MCP server registration.");
} catch {
  console.log("  'claude' not found or MCP server not registered — skipping.");
}

console.log("Done.");
