#!/usr/bin/env node
// Decky — PermissionRequest hook (non-blocking, mirror only)
//
// Called by Claude Code when a permission dialog is about to appear.
// POSTs the event to the Decky bridge so the StreamDeck can show approval buttons,
// then exits 0 immediately to let Claude show its own dialog.
"use strict";

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const EVENT = "PermissionRequest";
const BRIDGE_URL = process.env.DECKY_BRIDGE_URL || "http://localhost:9130";
const DECKY_HOME = process.env.DECKY_HOME || path.join(os.homedir(), ".decky");
const TOKEN_FILE = path.join(DECKY_HOME, "bridge-token");

function readToken() {
  if (process.env.DECKY_AUTH_TOKEN) return process.env.DECKY_AUTH_TOKEN.trim();
  try {
    return fs.readFileSync(TOKEN_FILE, "utf-8").trim();
  } catch {
    return "";
  }
}

function postToBridge(body, token) {
  const url = new URL("/hook", BRIDGE_URL);
  const mod = url.protocol === "https:" ? https : http;
  const req = mod.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-decky-event": EVENT,
      "x-decky-approval-flow": "mirror",
      ...(token ? { "x-decky-token": token } : {}),
    },
  });
  req.on("error", () => {}); // Non-blocking — ignore errors
  req.end(body);
}

if (process.env.DECKY_HOOK_DEBUG === "1") {
  process.stderr.write("[decky-hook] permission-request\n");
}

let payload = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { payload += chunk; });
process.stdin.on("end", () => {
  if (!payload.trim()) payload = "{}";
  postToBridge(payload, readToken());
});
