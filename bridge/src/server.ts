/**
 * Decky Bridge Server — entry point
 *
 * Creates the app and starts listening on the configured port.
 */

import { createApp } from "./app.js";

const PORT = parseInt(process.env.DECKY_PORT ?? "9130", 10);

const { httpServer } = createApp();

httpServer.listen(PORT, () => {
  console.log(`[decky] bridge server listening on http://localhost:${PORT}`);
  console.log(`[decky] POST /hook   — receive Claude Code hook events`);
  console.log(`[decky] GET  /status — current state snapshot`);
  console.log(`[decky] Socket.io    — stateChange events on connect`);
});
