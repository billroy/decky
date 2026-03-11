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
import rateLimit from "express-rate-limit";
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
  setApprovalAttemptLogger,
  startDictationForClaude,
  surfaceTargetApp,
  withApprovalAttemptContext,
} from "./macro-exec.js";
import { getBridgeToken, readRequestToken, redactActionForLog } from "./security.js";
import { ApprovalTraceStore } from "./approval-trace.js";

const MAX_MACRO_ACTION_TEXT = 2000;

const VALID_EVENTS: Set<string> = new Set([
  "PreToolUse",
  "PermissionRequest",
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
  if (key === "permissionrequest" || key === "permission_request" || key === "permission-request") return "PermissionRequest";
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

interface ApprovalQueueItem {
  id: string;
  flow: ApprovalFlow;
  nonce: string | null;
  tool: string | null;
  createdAt: number;
}

interface PlatformCapabilities {
  textInjection: boolean;
  approveInApp: boolean;
  dictation: boolean;
  platform: string;
}

const platformCapabilities: PlatformCapabilities = {
  textInjection: process.platform === "darwin",
  approveInApp: process.platform === "darwin",
  dictation: process.platform === "darwin",
  platform: process.platform,
};

interface StatePayload {
  state: string;
  previousState: string | null;
  tool: string | null;
  lastEvent: string | null;
  timestamp: number;
  capabilities: PlatformCapabilities;
  approval: {
    pending: number;
    position: number;
    flow: ApprovalFlow;
  } | null;
}

function normalizeActionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9._:-]{6,120}$/.test(trimmed) ? trimmed : null;
}

function createActionId(prefix = "bridge"): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

export function createApp(): DeckyApp {
  const app = express();
  const httpServer = createServer(app);
  const bridgeToken = getBridgeToken();
  const approvalTrace = new ApprovalTraceStore();
  const approvalQueue: ApprovalQueueItem[] = [];
  let pendingGateNonce: string | null = null;
  let pendingApprovalFlow: ApprovalFlow = "gate";

  const io = new SocketIOServer(httpServer, {
    maxHttpBufferSize: 100_000,
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

  setApprovalAttemptLogger((attempt) => {
    if (!attempt.contextId) return;
    approvalTrace.append(
      attempt.contextId,
      "macro.attempt",
      `${attempt.phase}:${attempt.strategy}`,
      {
        targetApp: attempt.targetApp,
        hostApp: attempt.hostApp,
        success: attempt.success,
        detail: attempt.detail,
        error: attempt.error,
      },
    );
  });

  // Load config from ~/.decky/config.json
  loadConfig();

  function currentApproval(): ApprovalQueueItem | null {
    return approvalQueue.length > 0 ? approvalQueue[0] : null;
  }

  function applyPendingFromQueue(): void {
    const active = currentApproval();
    if (!active) {
      pendingGateNonce = null;
      return;
    }
    pendingApprovalFlow = active.flow;
    pendingGateNonce = active.nonce;
  }

  function enqueueApprovalRequest(item: Omit<ApprovalQueueItem, "id" | "createdAt">): ApprovalQueueItem {
    const queued: ApprovalQueueItem = {
      id: createActionId("req"),
      createdAt: Date.now(),
      ...item,
    };
    approvalQueue.push(queued);
    applyPendingFromQueue();
    return queued;
  }

  function shiftApprovalRequest(): ApprovalQueueItem | null {
    if (approvalQueue.length === 0) return null;
    const removed = approvalQueue.shift() ?? null;
    applyPendingFromQueue();
    return removed;
  }

  /** Surface the target app for the currently active approval request (if popUpApp is enabled). */
  function surfaceActiveApproval(): void {
    if (!getConfig().popUpApp) return;
    const active = currentApproval();
    if (active) {
      surfaceTargetApp("claude").catch((err) => {
        console.error("[queue] surfaceTargetApp on advance failed:", err);
      });
    }
  }

  function statePayload(snapshot = sm.getSnapshot()): StatePayload {
    const active = currentApproval();
    return {
      ...snapshot,
      capabilities: platformCapabilities,
      approval: active
        ? {
          pending: approvalQueue.length,
          position: approvalQueue.findIndex((item) => item.id === active.id) + 1,
          flow: active.flow,
        }
        : null,
    };
  }

  function emitState(snapshot = sm.getSnapshot()): void {
    io.emit("stateChange", statePayload(snapshot));
  }

  // Broadcast state changes to all connected Socket.io clients
  sm.onStateChange((snapshot) => {
    if ((snapshot.state === "idle" || snapshot.state === "stopped") && approvalQueue.length > 0) {
      approvalQueue.splice(0, approvalQueue.length);
      applyPendingFromQueue();
    }
    emitState(snapshot);
  });

  function applyHookPayload(
    payload: HookPayload,
    options?: {
      approvalFlow?: ApprovalFlow;
      nonce?: string | null;
    },
  ) {
    const flow = options?.approvalFlow ?? "mirror";

    // Mirror-flow hooks use PermissionRequest for approval, not PreToolUse.
    // Skip PreToolUse entirely in mirror flow — it's informational.
    if (payload.event === "PreToolUse" && flow === "mirror") {
      console.log(
        `[hook] PreToolUse (mirror, skip) tool=${payload.tool ?? "?"}`,
      );
      return sm.getSnapshot();
    }

    // Enqueue approval for events that trigger the approval UI:
    // - PermissionRequest (mirror flow — only fires when dialog appears)
    // - PreToolUse (gate flow)
    if (payload.event === "PermissionRequest" || payload.event === "PreToolUse") {
      if (payload.event === "PreToolUse" && flow === "gate") {
        clearGateFile();
      }
      const nonce = options?.nonce ?? null;
      const current = sm.getSnapshot();
      const duplicatePre = current.state === "awaiting-approval";
      if (!duplicatePre) {
        const queued = enqueueApprovalRequest({
          flow,
          nonce,
          tool: payload.tool ?? null,
        });
        // Surface the target app when this request becomes the active one
        if (getConfig().popUpApp && currentApproval()?.id === queued.id) {
          surfaceTargetApp("claude").catch((err) => {
            console.error("[queue] surfaceTargetApp on arrival failed:", err);
          });
        }
      }
    }
    let snapshot = sm.processEvent(payload);

    if (
      payload.event === "PostToolUse" || payload.event === "Stop" || payload.event === "SubagentStop"
    ) {
      const shifted = shiftApprovalRequest();
      if (shifted) {
        const next = currentApproval();
        if (next && snapshot.state !== "awaiting-approval") {
          snapshot = sm.forceState("awaiting-approval", "queued approval pending", next.tool);
          surfaceActiveApproval();
        } else {
          emitState(snapshot);
        }
      }
    }

    if (
      (payload.event === "PreToolUse" || payload.event === "PermissionRequest") &&
      approvalQueue.length > 1
    ) {
      emitState(snapshot);
    }

    return snapshot;
  }

  httpServer.on("close", () => {
    setApprovalAttemptLogger(null);
  });

  // --- Middleware ---

  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    if (readRequestToken(req) !== bridgeToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // --- Rate limiting ---

  const hookLimiter = rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });

  const configLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });

  app.use("/hook", hookLimiter);
  app.use("/config", configLimiter);

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
    const approvalFlow =
      typeof flowHeader === "string" && flowHeader.trim().toLowerCase() === "gate"
        ? "gate"
        : "mirror";
    const nonce =
      typeof nonceHeader === "string" && nonceHeader.trim().length > 0
        ? nonceHeader.trim()
        : null;
    const snapshot = applyHookPayload(payload, { approvalFlow, nonce });
    res.json({ ok: true, state: statePayload(snapshot) });
  });

  app.get("/status", (_req, res) => {
    res.json(statePayload());
  });

  if (process.env.DECKY_DEBUG === "1" || process.env.DECKY_DEBUG === "true") {
    app.get("/debug/approval-trace", (req, res) => {
      const raw = typeof req.query.limit === "string" ? Number(req.query.limit) : 25;
      const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.floor(raw))) : 25;
      res.json({
        traces: approvalTrace.list(limit),
        approvalQueue: approvalQueue.map((entry, idx) => ({
          id: entry.id,
          index: idx + 1,
          flow: entry.flow,
          tool: entry.tool,
          createdAt: entry.createdAt,
        })),
        now: Date.now(),
      });
    });
  }

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

    socket.emit("stateChange", statePayload());
    socket.emit("configUpdate", getConfig());

    const ACTION_THROTTLE_MS = 200;
    const THROTTLE_EXEMPT = new Set(["approve", "deny", "cancel", "restart", "approveOnceInClaude"]);
    let lastThrottledActionTime = 0;

    socket.on("action", (data: { action: string; [key: string]: unknown }) => {
      if (!THROTTLE_EXEMPT.has(data.action)) {
        const now = Date.now();
        if (now - lastThrottledActionTime < ACTION_THROTTLE_MS) {
          socket.emit("error", { error: "Action throttled" });
          return;
        }
        lastThrottledActionTime = now;
      }

      const actionId = normalizeActionId(data.actionId) ?? createActionId("sd");
      console.log(`[io] action received: ${JSON.stringify(redactActionForLog(data as Record<string, unknown>))}`);

      const validActions: Record<string, { result: ApprovalResult; state: string; reason: string }> = {
        approve: { result: "approve", state: "tool-executing", reason: "approved via StreamDeck" },
        deny:    { result: "deny",    state: "idle",            reason: "denied via StreamDeck" },
        cancel:  { result: "cancel",  state: "stopped",        reason: "cancelled via StreamDeck" },
      };

      const entry = validActions[data.action];
      if (entry) {
        const currentState = sm.getSnapshot().state;
        const activeApproval = currentApproval();
        const activeFlow = activeApproval?.flow ?? pendingApprovalFlow;
        approvalTrace.start({ actionId, action: data.action, targetApp: "claude" });
        approvalTrace.append(actionId, "bridge.action.received", "approval action received", {
          action: data.action,
          state: currentState,
          pendingApprovalFlow: activeFlow,
          socketId: socket.id,
          queued: approvalQueue.length,
        });

        const settleFailed = (errorText: string, reason: string): void => {
          approvalTrace.append(actionId, "bridge.action.failed", reason, { error: errorText });
          approvalTrace.settle({
            actionId,
            status: "failed",
            finalState: sm.getSnapshot().state,
            finalReason: reason,
          });
          socket.emit("error", { error: errorText });
        };

        if (data.action === "cancel" && currentState !== "awaiting-approval") {
          sm.forceState("stopped", "cancelled via StreamDeck");
          approvalTrace.append(actionId, "state.force", "forced state", {
            state: "stopped",
            reason: "cancelled via StreamDeck",
          });
          approvalTrace.settle({
            actionId,
            status: "settled",
            finalState: "stopped",
            finalReason: "cancelled via StreamDeck",
          });
          withApprovalAttemptContext(actionId, () => dismissClaudeApproval()).catch((err) => {
            console.error("[io] cancel action failed outside approval state:", err);
            socket.emit("error", { error: "Failed to dismiss Claude" });
          });
          return;
        }

        if (currentState !== "awaiting-approval") {
          approvalTrace.append(actionId, "bridge.action.ignored", "not awaiting approval", { state: currentState });
          approvalTrace.settle({
            actionId,
            status: "failed",
            finalState: currentState,
            finalReason: "Approval action ignored: not awaiting approval",
          });
          socket.emit("error", { error: "Approval action ignored: not awaiting approval" });
          return;
        }
        if (!activeApproval) {
          approvalTrace.append(
            actionId,
            "bridge.action.ignored",
            "awaiting approval without active queue context",
            { state: currentState, pendingApprovalFlow },
          );
          approvalTrace.settle({
            actionId,
            status: "failed",
            finalState: currentState,
            finalReason: "Approval action ignored: no active approval context",
          });
          socket.emit("error", { error: "Approval action ignored: no active approval context" });
          return;
        }
        if (activeFlow === "mirror") {
          pendingGateNonce = null;
          if (entry.result === "approve") {
            withApprovalAttemptContext(actionId, () => approveOnceInClaude()).catch((err) => {
              console.error("[io] approve action failed in mirror flow:", err);
              settleFailed("Failed to approve in Claude", "approve action failed in mirror flow");
            });
            approvalTrace.setStatus(actionId, "settling", "mirror approve dispatched");
          } else {
            const mirrorDismissReason = `${entry.result} via StreamDeck (mirror)`;
            withApprovalAttemptContext(actionId, () => dismissClaudeApproval()).then(() => {
              shiftApprovalRequest();
              const next = currentApproval();
              if (next) {
                sm.forceState("awaiting-approval", "queued approval pending", next.tool);
                surfaceActiveApproval();
              } else {
                sm.forceState("idle", mirrorDismissReason);
              }
              approvalTrace.append(actionId, "state.force", "forced state", {
                state: next ? "awaiting-approval" : "idle",
                reason: next ? "queued approval pending" : mirrorDismissReason,
              });
              approvalTrace.settle({
                actionId,
                status: "settled",
                finalState: next ? "awaiting-approval" : "idle",
                finalReason: next ? "queued approval pending" : mirrorDismissReason,
              });
            }).catch((err) => {
              console.error("[io] deny/cancel action failed in mirror flow:", err);
              settleFailed("Failed to dismiss Claude approval", "deny/cancel action failed in mirror flow");
            });
          }
          return;
        }
        writeGateFile(entry.result, pendingGateNonce ?? undefined);
        pendingGateNonce = null;
        shiftApprovalRequest();
        const next = currentApproval();
        if (next) {
          sm.forceState("awaiting-approval", "queued approval pending", next.tool);
          surfaceActiveApproval();
        } else {
          sm.forceState(entry.state as Parameters<typeof sm.forceState>[0], entry.reason);
        }
        approvalTrace.append(actionId, "gate.write", "wrote gate result", { result: entry.result });
        approvalTrace.append(actionId, "state.force", "forced state", {
          state: next ? "awaiting-approval" : entry.state,
          reason: next ? "queued approval pending" : entry.reason,
        });
        approvalTrace.settle({
          actionId,
          status: "settled",
          finalState: next ? "awaiting-approval" : entry.state,
          finalReason: next ? "queued approval pending" : entry.reason,
        });
      } else if (data.action === "restart") {
        sm.forceState("idle", "restarted via StreamDeck");
      } else if (data.action === "macro") {
        const macroText = typeof data.text === "string" ? data.text : null;
        console.log(
          `[io] macro request: targetApp=${data.targetApp ?? "(default)"} ` +
            `textLen=${macroText?.length ?? "null"} submit=${data.submit ?? true}` +
            (macroText ? ` text="${macroText.slice(0, 50)}${macroText.length > 50 ? "…" : ""}"` : " text=<empty>"),
        );
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
          shiftApprovalRequest();
          const next = currentApproval();
          if (next) {
            sm.forceState("awaiting-approval", "queued approval pending", next.tool);
            surfaceActiveApproval();
          } else {
            sm.forceState("tool-executing", "approved via StreamDeck (approve once)");
          }
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
        const popUpApp =
          typeof data.popUpApp === "boolean" ? data.popUpApp : undefined;
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
        if (colors) update.colors = colors;
        if (defaultTargetApp) update.defaultTargetApp = defaultTargetApp;
        if (showTargetBadge !== undefined) update.showTargetBadge = showTargetBadge;
        if (popUpApp !== undefined) update.popUpApp = popUpApp;
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
