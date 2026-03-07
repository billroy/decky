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
import { writeGateFile, clearGateFile, type ApprovalResult } from "./approval-gate.js";
import { loadConfig, getConfig, reloadConfig } from "./config.js";
import { executeMacro } from "./macro-exec.js";

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

  // Load config from ~/.decky/config.json
  loadConfig();

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

    // Clear any stale gate file when a new tool-approval cycle starts
    if (payload.event === "PreToolUse") {
      clearGateFile();
    }

    const snapshot = sm.processEvent(payload);
    res.json({ ok: true, state: snapshot });
  });

  app.get("/status", (_req, res) => {
    res.json(sm.getSnapshot());
  });

  app.get("/config", (_req, res) => {
    res.json(getConfig());
  });

  app.post("/config/reload", (_req, res) => {
    const config = reloadConfig();
    io.emit("configUpdate", config);
    res.json({ ok: true, config });
  });

  // --- Socket.io connections ---

  io.on("connection", (socket) => {
    console.log(`[io] client connected: ${socket.id}`);

    socket.emit("stateChange", sm.getSnapshot());
    socket.emit("configUpdate", getConfig());

    socket.on("action", (data: { action: string; [key: string]: unknown }) => {
      console.log(`[io] action received: ${JSON.stringify(data)}`);

      const validActions: Record<string, { result: ApprovalResult; state: string; reason: string }> = {
        approve: { result: "approve", state: "tool-executing", reason: "approved via StreamDeck" },
        deny:    { result: "deny",    state: "thinking",       reason: "denied via StreamDeck" },
        cancel:  { result: "cancel",  state: "stopped",        reason: "cancelled via StreamDeck" },
      };

      const entry = validActions[data.action];
      if (entry) {
        writeGateFile(entry.result);
        sm.forceState(entry.state as Parameters<typeof sm.forceState>[0], entry.reason);
      } else if (data.action === "restart") {
        sm.forceState("idle", "restarted via StreamDeck");
      } else if (data.action === "macro") {
        const macroText = typeof data.text === "string" ? data.text : null;
        if (macroText) {
          executeMacro(macroText).catch((err) => {
            console.error("[io] macro execution failed:", err);
          });
        } else {
          console.log(`[io] macro pressed with no text: ${JSON.stringify(data)}`);
        }
      } else {
        console.log(`[io] unknown action: ${data.action}`);
      }
    });

    socket.on("disconnect", () => {
      console.log(`[io] client disconnected: ${socket.id}`);
    });
  });

  return { app, httpServer, io, sm };
}
