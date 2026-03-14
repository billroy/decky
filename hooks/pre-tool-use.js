#!/usr/bin/env node
// Decky — PreToolUse hook (blocking)
//
// Called by Claude Code before a tool executes.
// 1. Reads hook JSON payload from stdin.
// 2. POSTs it to the Decky bridge so the StreamDeck can show approval buttons.
// 3. Polls ~/.decky/approval-gate until the user presses a button.
// 4. Exits 0 (approve) or 2 (deny/cancel, which blocks the tool).
//
// Timeout: defaults to 30 s — override with DECKY_TIMEOUT env var.
"use strict";

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const BRIDGE_URL = process.env.DECKY_BRIDGE_URL || "http://localhost:9130";
const APPROVAL_FLOW = (process.env.DECKY_APPROVAL_FLOW || "mirror").toLowerCase() === "gate" ? "gate" : "mirror";
const DECKY_HOME = process.env.DECKY_HOME || path.join(os.homedir(), ".decky");
const TOKEN_FILE = path.join(DECKY_HOME, "bridge-token");
const GATE_FILE = path.join(DECKY_HOME, "approval-gate");
const parsedTimeout = parseInt(process.env.DECKY_TIMEOUT ?? "", 10);
const TIMEOUT = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 30;
const POLL_INTERVAL_MS = 200;

let nonce;
try {
  nonce = crypto.randomBytes(12).toString("hex");
} catch {
  nonce = `${Date.now()}-${process.pid}`;
}

if (process.env.DECKY_HOOK_DEBUG === "1") {
  process.stderr.write(`[decky-hook] pre-tool approval_flow=${APPROVAL_FLOW}\n`);
}

function readToken() {
  if (process.env.DECKY_AUTH_TOKEN) return process.env.DECKY_AUTH_TOKEN.trim();
  try {
    return fs.readFileSync(TOKEN_FILE, "utf-8").trim();
  } catch {
    return "";
  }
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
  process.exit(2);
}

// POST to bridge, returns a promise that resolves with HTTP status code
function postToBridge(body, token) {
  return new Promise((resolve) => {
    const url = new URL("/hook", BRIDGE_URL);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-decky-event": "PreToolUse",
        "x-decky-approval-flow": APPROVAL_FLOW,
        "x-decky-nonce": nonce,
        ...(token ? { "x-decky-token": token } : {}),
      },
    }, (res) => {
      // Consume response body to avoid memory leaks
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", () => resolve(0));
    req.setTimeout(5000, () => { req.destroy(); resolve(0); });
    req.end(body);
  });
}

// Clear any stale gate file
function clearGateFile() {
  try { fs.unlinkSync(GATE_FILE); } catch { /* ignore */ }
}

// Poll for the gate file, validate, return result
function pollGateFile() {
  const maxTicks = TIMEOUT * (1000 / POLL_INTERVAL_MS);
  let ticks = 0;

  const timer = setInterval(() => {
    ticks++;
    if (ticks >= maxTicks) {
      clearInterval(timer);
      block("Decky approval timed out");
    }

    if (!fs.existsSync(GATE_FILE)) return;
    clearInterval(timer);

    // Integrity check: owner and permissions.
    // NOTE: stat-then-read is a TOCTOU pattern, but acceptable here because
    // both processes (bridge writer + hook reader) run as the same local user.
    try {
      const stat = fs.statSync(GATE_FILE);
      const myUid = process.getuid ? process.getuid() : -1;
      // On Windows, getuid() doesn't exist; skip UID check
      if (myUid !== -1 && stat.uid !== myUid) {
        clearGateFile();
        block("Decky approval gate integrity check failed");
      }
      // Check mode: 0o600 = 33152 (decimal). Mask with 0o777 to get permission bits.
      const modeBits = stat.mode & 0o777;
      if (modeBits !== 0o600 && process.platform !== "win32") {
        clearGateFile();
        block("Decky approval gate integrity check failed");
      }
    } catch {
      clearGateFile();
      block("Decky approval gate integrity check failed");
    }

    // Read the result
    let result;
    try {
      result = fs.readFileSync(GATE_FILE, "utf-8").trim();
    } catch {
      block("Decky approval gate read failed");
    }
    clearGateFile();

    // Nonce validation
    const expectedPrefix = nonce + ":";
    if (result.startsWith(expectedPrefix)) {
      result = result.slice(expectedPrefix.length);
    } else {
      block("Decky approval response nonce mismatch");
    }

    switch (result) {
      case "approve":
        process.exit(0);
        break;
      case "deny":
        block("Denied via StreamDeck");
        break;
      case "cancel":
        block("Cancelled via StreamDeck");
        break;
      default:
        block("Decky approval gate returned invalid value");
    }
  }, POLL_INTERVAL_MS);
}

// Main flow
let payload = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { payload += chunk; });
process.stdin.on("end", async () => {
  if (!payload.trim()) payload = "{}";

  // Ensure ~/.decky/ exists
  fs.mkdirSync(DECKY_HOME, { recursive: true });

  // Clear stale gate file
  clearGateFile();

  const token = readToken();
  const statusCode = await postToBridge(payload, token);

  if (statusCode < 200 || statusCode >= 300) {
    block(`Decky bridge unavailable or unauthorized (HTTP ${statusCode})`);
  }

  // Mirror mode: do not block native Claude approval flow
  if (APPROVAL_FLOW === "mirror") {
    process.exit(0);
  }

  // Gate mode: poll for gate file
  pollGateFile();
});
