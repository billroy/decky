/**
 * Decky Bridge Server
 *
 * Receives Claude Code lifecycle hook events via HTTP POST,
 * manages session state, and broadcasts state changes over Socket.io.
 *
 * Endpoints:
 *   POST /hook   — accept hook payloads from Claude Code hook scripts
 *   GET  /status — return current state snapshot as JSON
 *
 * Socket.io events emitted:
 *   stateChange  — fired on every state transition (payload: StateSnapshot)
 */

import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { StateMachine, type HookPayload, type HookEvent } from "./state-machine.js";

const PORT = parseInt(process.env.DECKY_PORT ?? "9130", 10);
const VALID_EVENTS: Set<string> = new Set([
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
]);

// --- App setup ---

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" }, // localhost-only; no auth needed per spec
});

const sm = new StateMachine();

// Broadcast state changes to all connected Socket.io clients
sm.onStateChange((snapshot) => {
  io.emit("stateChange", snapshot);
});

// --- Middleware ---

app.use(express.json());

// --- Routes ---

app.post("/hook", (req, res) => {
  const body = req.body as Record<string, unknown>;

  // Validate event field
  const event = body?.event as string | undefined;
  if (!event || !VALID_EVENTS.has(event)) {
    console.log(`[hook] rejected: invalid event "${event}"`);
    res.status(400).json({
      error: "Invalid or missing 'event' field",
      validEvents: [...VALID_EVENTS],
    });
    return;
  }

  const payload: HookPayload = {
    event: event as HookEvent,
    tool: typeof body.tool === "string" ? body.tool : undefined,
    input: body.input,
  };

  console.log(
    `[hook] received: event=${payload.event}${payload.tool ? ` tool=${payload.tool}` : ""}`
  );

  const snapshot = sm.processEvent(payload);

  res.json({ ok: true, state: snapshot });
});

app.get("/status", (_req, res) => {
  res.json(sm.getSnapshot());
});

// --- Socket.io connections ---

io.on("connection", (socket) => {
  console.log(`[io] client connected: ${socket.id}`);

  // Send current state immediately on connect
  socket.emit("stateChange", sm.getSnapshot());

  // Handle actions from StreamDeck plugin (future phases)
  socket.on("action", (data: { action: string; [key: string]: unknown }) => {
    console.log(`[io] action received: ${JSON.stringify(data)}`);

    switch (data.action) {
      case "approve":
        sm.forceState("tool-executing", "approved via StreamDeck");
        break;
      case "deny":
        sm.forceState("thinking", "denied via StreamDeck");
        break;
      case "cancel":
        sm.forceState("stopped", "cancelled via StreamDeck");
        break;
      default:
        console.log(`[io] unknown action: ${data.action}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[io] client disconnected: ${socket.id}`);
  });
});

// --- Start ---

httpServer.listen(PORT, () => {
  console.log(`[decky] bridge server listening on http://localhost:${PORT}`);
  console.log(`[decky] POST /hook   — receive Claude Code hook events`);
  console.log(`[decky] GET  /status — current state snapshot`);
  console.log(`[decky] Socket.io    — stateChange events on connect`);
});
