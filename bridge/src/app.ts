/**
 * Decky Bridge — app factory
 *
 * Creates and returns the Express app, HTTP server, Socket.io instance,
 * and state machine. Separated from server.ts so tests can create
 * isolated instances without binding to a fixed port.
 */

import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { StateMachine, type HookPayload, type HookEvent } from "./state-machine.js";

const VALID_EVENTS: Set<string> = new Set([
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
]);

export interface DeckyApp {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketIOServer;
  sm: StateMachine;
}

export function createApp(): DeckyApp {
  const app = express();
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
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

    const event = body?.event as string | undefined;
    if (!event || !VALID_EVENTS.has(event)) {
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

    socket.emit("stateChange", sm.getSnapshot());

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

  return { app, httpServer, io, sm };
}
