#!/usr/bin/env node
// Decky — Stop hook (non-blocking)
// Reads JSON from stdin and forwards to the bridge.
"use strict";

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const EVENT = "Stop";
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
      ...(token ? { "x-decky-token": token } : {}),
    },
  });
  req.on("error", () => {}); // Non-blocking — ignore errors
  req.end(body);
}

let payload = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { payload += chunk; });
process.stdin.on("end", () => {
  if (!payload.trim()) payload = "{}";
  postToBridge(payload, readToken());
});
