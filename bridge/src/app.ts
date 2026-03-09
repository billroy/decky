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
import {
  loadConfig,
  getConfig,
  listConfigBackups,
  reloadConfig,
  restoreConfigBackup,
  saveConfig,
  type Theme,
  ConfigValidationError,
} from "./config.js";
import {
  executeMacro,
  approveOnceInClaude,
  dismissClaudeApproval,
  approveInTargetApp,
  dismissApprovalInTargetApp,
  startDictationForClaude,
} from "./macro-exec.js";
import { getBridgeToken, readRequestToken, redactActionForLog } from "./security.js";
import { CodexMonitor } from "./codex-monitor.js";

const MAX_MACRO_ACTION_TEXT = 2000;

const VALID_EVENTS: Set<string> = new Set([
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
]);

function normalizeHookEvent(value: unknown): HookEvent | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (VALID_EVENTS.has(raw)) return raw as HookEvent;

  const key = raw.toLowerCase();
  if (key === "pretooluse" || key === "pre_tool_use" || key === "pre-tool-use") return "PreToolUse";
  if (key === "posttooluse" || key === "post_tool_use" || key === "post-tool-use") return "PostToolUse";
  if (key === "notification") return "Notification";
  if (key === "stop") return "Stop";
  if (key === "subagentstop" || key === "subagent_stop" || key === "subagent-stop") return "SubagentStop";
  return undefined;
}

function extractToolName(body: Record<string, unknown>): string | undefined {
  if (typeof body.tool === "string") return body.tool;
  if (typeof body.tool_name === "string") return body.tool_name;
  if (typeof body.toolName === "string") return body.toolName;
  if (body.tool && typeof body.tool === "object") {
    const toolObj = body.tool as Record<string, unknown>;
    if (typeof toolObj.name === "string") return toolObj.name;
  }
  return undefined;
}

function isTheme(value: unknown): value is Theme {
  return value === "light" ||
    value === "dark" ||
    value === "dracula" ||
    value === "monokai" ||
    value === "solarized-dark" ||
    value === "solarized-light" ||
    value === "nord" ||
    value === "github-dark" ||
    value === "candy-cane" ||
    value === "gradient-blue" ||
    value === "wormhole" ||
    value === "rainbow" ||
    value === "random";
}

export interface DeckyApp {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketIOServer;
  sm: StateMachine;
}

type ApprovalFlow = "gate" | "mirror";
type ApprovalTargetApp = "claude" | "codex";

function parseApprovalTargetApp(value: unknown): ApprovalTargetApp {
  return value === "codex" ? "codex" : "claude";
}

export function createApp(): DeckyApp {
  const app = express();
  const httpServer = createServer(app);
  const bridgeToken = getBridgeToken();
  let pendingGateNonce: string | null = null;
  let pendingApprovalFlow: ApprovalFlow = "gate";
  let pendingApprovalTargetApp: ApprovalTargetApp = "claude";

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (/^https?:\/\/localhost(?::\d+)?$/i.test(origin)) return cb(null, true);
        if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)) return cb(null, true);
        return cb(new Error("CORS blocked"));
      },
    },
  });

  const sm = new StateMachine();

  // Load config from ~/.decky/config.json
  loadConfig();

  // Broadcast state changes to all connected Socket.io clients
  sm.onStateChange((snapshot) => {
    io.emit("stateChange", snapshot);
  });

  function applyHookPayload(
    payload: HookPayload,
    options?: {
      approvalFlow?: ApprovalFlow;
      nonce?: string | null;
      targetApp?: ApprovalTargetApp;
    },
  ) {
    // Clear any stale gate file when a new tool-approval cycle starts
    if (payload.event === "PreToolUse") {
      clearGateFile();
      pendingApprovalFlow = options?.approvalFlow ?? "gate";
      pendingApprovalTargetApp = options?.targetApp ?? "claude";
      pendingGateNonce = options?.nonce ?? null;
    }
    return sm.processEvent(payload);
  }

  const isTestRuntime =
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    (process.env.DECKY_HOME ?? "").includes(".decky-test");
  const codexMonitorEnabled = !isTestRuntime && process.env.DECKY_ENABLE_CODEX_MONITOR !== "0";
  let codexMonitor: CodexMonitor | null = null;
  if (codexMonitorEnabled) {
    codexMonitor = new CodexMonitor({
      onHookEvent: (payload) => {
        const opts =
          payload.event === "PreToolUse"
            ? { approvalFlow: "mirror" as const, nonce: null, targetApp: "codex" as const }
            : undefined;
        applyHookPayload(payload, opts);
      },
      onError: (error) => {
        console.warn("[codex-monitor] poll error:", error);
      },
    });
    void codexMonitor.start().then((started) => {
      if (started) {
        console.log("[codex-monitor] mirroring Codex approval events from state DB");
      }
    });
    httpServer.on("close", () => {
      codexMonitor?.stop();
    });
  }

  // --- Middleware ---

  app.use(express.json());
  app.use((req, res, next) => {
    if (readRequestToken(req) !== bridgeToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // --- Routes ---

  app.post("/hook", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const event =
      normalizeHookEvent(body?.event) ??
      normalizeHookEvent(body?.hook_event_name) ??
      normalizeHookEvent(req.header("x-decky-event"));
    if (!event) {
      res.status(400).json({
        error: "Invalid or missing 'event' field",
        validEvents: [...VALID_EVENTS],
      });
      return;
    }

    const payload: HookPayload = {
      event,
      tool: extractToolName(body),
      input: body.input,
    };

    console.log(
      `[hook] received: event=${payload.event}${payload.tool ? ` tool=${payload.tool}` : ""}`
    );

    const flowHeader = req.header("x-decky-approval-flow");
    const nonceHeader = req.header("x-decky-nonce");
    const targetHeader = req.header("x-decky-target-app");
    const approvalFlow =
      typeof flowHeader === "string" && flowHeader.trim().toLowerCase() === "mirror"
        ? "mirror"
        : "gate";
    const nonce =
      typeof nonceHeader === "string" && nonceHeader.trim().length > 0
        ? nonceHeader.trim()
        : null;
    const targetApp =
      payload.event === "PreToolUse"
        ? parseApprovalTargetApp(
            typeof targetHeader === "string" && targetHeader.trim().length > 0
              ? targetHeader.trim()
              : body?.targetApp,
          )
        : undefined;
    const snapshot = applyHookPayload(payload, { approvalFlow, nonce, targetApp });
    res.json({ ok: true, state: snapshot });
  });

  app.get("/status", (_req, res) => {
    res.json(sm.getSnapshot());
  });

  app.get("/config", (_req, res) => {
    res.json(getConfig());
  });

  app.put("/config", (req, res) => {
    const body = req.body as Record<string, unknown>;
    try {
      const config = saveConfig(body);
      io.emit("configUpdate", config);
      res.json({ ok: true, config });
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: "Failed to save config" });
    }
  });

  app.post("/config/reload", (_req, res) => {
    const config = reloadConfig();
    io.emit("configUpdate", config);
    res.json({ ok: true, config });
  });

  app.get("/config/backups", (_req, res) => {
    res.json({ backups: listConfigBackups() });
  });

  app.post("/config/restore", (req, res) => {
    const body = req.body as Record<string, unknown>;
    const idxRaw = body?.index;
    const index = typeof idxRaw === "number" ? Math.floor(idxRaw) : Number.NaN;
    try {
      const config = restoreConfigBackup(index);
      io.emit("configUpdate", config);
      res.json({ ok: true, config, restoredIndex: index, backups: listConfigBackups() });
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: "Failed to restore config backup" });
    }
  });

  // --- Socket.io connections ---

  io.on("connection", (socket) => {
    const token =
      (typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token.trim() : "") ||
      (typeof socket.handshake.headers["x-decky-token"] === "string"
        ? socket.handshake.headers["x-decky-token"].trim()
        : "");
    if (token !== bridgeToken) {
      socket.emit("error", { error: "Unauthorized" });
      socket.disconnect(true);
      return;
    }
    console.log(`[io] client connected: ${socket.id}`);

    socket.emit("stateChange", sm.getSnapshot());
    socket.emit("configUpdate", getConfig());

    socket.on("action", (data: { action: string; [key: string]: unknown }) => {
      console.log(`[io] action received: ${JSON.stringify(redactActionForLog(data as Record<string, unknown>))}`);

      const validActions: Record<string, { result: ApprovalResult; state: string; reason: string }> = {
        approve: { result: "approve", state: "tool-executing", reason: "approved via StreamDeck" },
        deny:    { result: "deny",    state: "thinking",       reason: "denied via StreamDeck" },
        cancel:  { result: "cancel",  state: "stopped",        reason: "cancelled via StreamDeck" },
      };

      const entry = validActions[data.action];
      if (entry) {
        const currentState = sm.getSnapshot().state;
        const approvalTargetApp =
          pendingApprovalTargetApp === "codex"
            ? "codex"
            : parseApprovalTargetApp(data.targetApp);

        if (data.action === "cancel" && currentState !== "awaiting-approval") {
          sm.forceState("stopped", "cancelled via StreamDeck");
          if (approvalTargetApp === "claude") {
            dismissClaudeApproval().catch((err) => {
              console.error("[io] cancel action failed outside approval state:", err);
              socket.emit("error", { error: "Failed to dismiss Claude" });
            });
          } else {
            dismissApprovalInTargetApp(approvalTargetApp).catch((err) => {
              console.error("[io] cancel action failed outside approval state:", err);
              socket.emit("error", { error: "Failed to dismiss Codex" });
            });
          }
          return;
        }

        if (currentState !== "awaiting-approval") {
          socket.emit("error", { error: "Approval action ignored: not awaiting approval" });
          return;
        }
        if (pendingApprovalFlow === "mirror") {
          pendingGateNonce = null;
          if (entry.result === "approve") {
            if (approvalTargetApp === "claude") {
              approveOnceInClaude().catch((err) => {
                console.error("[io] approve action failed in mirror flow:", err);
                socket.emit("error", { error: "Failed to approve in Claude" });
              });
            } else {
              approveInTargetApp(approvalTargetApp).catch((err) => {
                console.error("[io] approve action failed in mirror flow:", err);
                socket.emit("error", { error: "Failed to approve in Codex" });
              });
            }
          } else {
            sm.forceState("idle", `${entry.result} via StreamDeck (mirror)`);
            if (approvalTargetApp === "claude") {
              dismissClaudeApproval().catch((err) => {
                console.error("[io] deny/cancel action failed in mirror flow:", err);
                socket.emit("error", { error: "Failed to dismiss Claude approval" });
              });
            } else {
              dismissApprovalInTargetApp(approvalTargetApp).catch((err) => {
                console.error("[io] deny/cancel action failed in mirror flow:", err);
                socket.emit("error", { error: "Failed to dismiss Codex approval" });
              });
            }
          }
          return;
        }
        writeGateFile(entry.result, pendingGateNonce ?? undefined);
        pendingGateNonce = null;
        sm.forceState(entry.state as Parameters<typeof sm.forceState>[0], entry.reason);
      } else if (data.action === "restart") {
        sm.forceState("idle", "restarted via StreamDeck");
      } else if (data.action === "macro") {
        const macroText = typeof data.text === "string" ? data.text : null;
        if (macroText && macroText.length <= MAX_MACRO_ACTION_TEXT) {
          const cfg = getConfig();
          const targetApp =
            data.targetApp === "claude" ||
            data.targetApp === "codex" ||
            data.targetApp === "chatgpt" ||
            data.targetApp === "cursor" ||
            data.targetApp === "windsurf"
              ? data.targetApp
              : cfg.defaultTargetApp;
          const submit = typeof data.submit === "boolean" ? data.submit : true;
          executeMacro(macroText, { targetApp, submit }).catch((err) => {
            console.error("[io] macro execution failed:", err);
          });
        } else {
          socket.emit("error", { error: "Invalid macro payload" });
        }
      } else if (data.action === "approveOnceInClaude") {
        if (sm.getSnapshot().state === "awaiting-approval") {
          writeGateFile("approve", pendingGateNonce ?? undefined);
          pendingGateNonce = null;
          sm.forceState("tool-executing", "approved via StreamDeck (approve once)");
        }
        approveOnceInClaude().catch((err) => {
          console.error("[io] approveOnceInClaude failed:", err);
          socket.emit("error", { error: "Failed to activate Claude for approve once" });
        });
      } else if (data.action === "startDictationForClaude") {
        startDictationForClaude().catch((err) => {
          console.error("[io] startDictationForClaude failed:", err);
          socket.emit("error", { error: "Failed to start dictation in Claude" });
        });
      } else if (data.action === "updateConfig") {
        const requestId =
          typeof data.requestId === "string" && data.requestId.trim().length > 0
            ? data.requestId.trim()
            : undefined;
        let macros = Array.isArray(data.macros) ? data.macros : undefined;
        const timeout = typeof data.approvalTimeout === "number" ? data.approvalTimeout : undefined;
        const theme = isTheme(data.theme) ? data.theme : undefined;
        let themeSeed =
          typeof data.themeSeed === "number" && Number.isFinite(data.themeSeed)
            ? Math.floor(data.themeSeed)
            : undefined;
        const editor = typeof data.editor === "string" ? data.editor : undefined;
        let colors = data.colors && typeof data.colors === "object" ? data.colors : undefined;
        const defaultTargetApp =
          data.defaultTargetApp === "claude" ||
          data.defaultTargetApp === "codex" ||
          data.defaultTargetApp === "chatgpt" ||
          data.defaultTargetApp === "cursor" ||
          data.defaultTargetApp === "windsurf"
            ? data.defaultTargetApp
            : undefined;
        const showTargetBadge =
          typeof data.showTargetBadge === "boolean" ? data.showTargetBadge : undefined;
        const enableApproveOnce =
          typeof data.enableApproveOnce === "boolean" ? data.enableApproveOnce : undefined;
        const enableDictation =
          typeof data.enableDictation === "boolean" ? data.enableDictation : undefined;
        const themeApplyMode =
          data.themeApplyMode === "keep" ||
          data.themeApplyMode === "clear-page" ||
          data.themeApplyMode === "clear-all"
            ? data.themeApplyMode
            : undefined;
        const effectiveTheme = theme ?? getConfig().theme;
        if (
          themeApplyMode &&
          (effectiveTheme === "random" || effectiveTheme === "rainbow")
        ) {
          // Guarantee a fresh distribution for each explicit theme apply,
          // even if the PI sent a stale/missing seed.
          themeSeed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
        }
        if (themeApplyMode === "clear-page" || themeApplyMode === "clear-all") {
          colors = {};
        }
        if (themeApplyMode === "clear-all") {
          const source = Array.isArray(macros) ? macros : getConfig().macros;
          macros = source.map((m) => {
            if (!m || typeof m !== "object") return m;
            const clone = { ...(m as Record<string, unknown>) };
            delete clone.colors;
            return clone;
          });
        }
        const update: Record<string, unknown> = {};
        if (macros) update.macros = macros;
        if (timeout !== undefined) update.approvalTimeout = timeout;
        if (theme) update.theme = theme;
        if (themeSeed !== undefined) update.themeSeed = themeSeed;
        if (editor !== undefined) update.editor = editor;
        if (colors) update.colors = colors;
        if (defaultTargetApp) update.defaultTargetApp = defaultTargetApp;
        if (showTargetBadge !== undefined) update.showTargetBadge = showTargetBadge;
        if (enableApproveOnce !== undefined) update.enableApproveOnce = enableApproveOnce;
        if (enableDictation !== undefined) update.enableDictation = enableDictation;
        if (Object.keys(update).length > 0) {
          try {
            const config = saveConfig(update);
            io.emit("configUpdate", config);
            socket.emit("updateConfigAck", {
              requestId: requestId ?? null,
              config,
              theme: config.theme,
              macroCount: config.macros.length,
              hasPageColors: !!config.colors,
              timestamp: Date.now(),
            });
          } catch (err) {
            if (err instanceof ConfigValidationError) {
              socket.emit("updateConfigError", {
                requestId: requestId ?? null,
                error: err.message,
              });
              socket.emit("error", { error: err.message });
              return;
            }
            socket.emit("updateConfigError", {
              requestId: requestId ?? null,
              error: "Failed to save config",
            });
            socket.emit("error", { error: "Failed to save config" });
          }
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
