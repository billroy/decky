/**
 * Decky Bridge Server — entry point
 *
 * Creates the app and starts listening on the configured port.
 */

import { createApp } from "./app.js";
import { isReadOnly } from "./config.js";
import { isLoopbackAddress, rotateBridgeToken } from "./security.js";

const PORT = parseInt(process.env.DECKY_PORT ?? "9130", 10);
const HOST = process.env.DECKY_HOST ?? "127.0.0.1";

if (!isLoopbackAddress(HOST)) {
  const allowRemote = process.env.DECKY_ALLOW_REMOTE;
  if (allowRemote !== "1" && allowRemote !== "true") {
    console.error(`[decky] FATAL: DECKY_HOST="${HOST}" binds to a non-loopback address.`);
    console.error(`[decky] This exposes the bridge to the network. Set DECKY_ALLOW_REMOTE=1 to allow.`);
    process.exit(1);
  }
  console.warn(`\n${"=".repeat(70)}`);
  console.warn(`[decky] WARNING: Bridge binding to non-loopback address: ${HOST}`);
  console.warn(`[decky] The bridge is accessible from the network. Ensure token security.`);
  console.warn(`${"=".repeat(70)}\n`);
}

rotateBridgeToken();
console.log("[decky] bridge token rotated for this session");

const { httpServer } = createApp();

httpServer.listen(PORT, HOST, () => {
  console.log(`[decky] bridge server listening on http://${HOST}:${PORT}`);
  console.log(`[decky] POST /hook   — receive Claude Code hook events`);
  console.log(`[decky] GET  /status — current state snapshot`);
  console.log(`[decky] Socket.io    — stateChange events on connect`);
  console.log(`[decky] MCP mode     — ${isReadOnly() ? "read-only" : "read-write"}`);
});
