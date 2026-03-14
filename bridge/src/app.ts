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
import { StateMachine, type HookPayload, type HookEvent, type QuestionOption } from "./state-machine.js";
import {
  writeGateFile,
  clearGateFile,
  writeQuestionResponse,
  clearQuestionResponse,
  type ApprovalResult,
} from "./approval-gate.js";
import {
  loadConfig,
  getConfig,
  getToolRiskRules,
  isReadOnly,
  normalizeTheme,
  VALID_TARGET_APPS,
  saveConfig,
  ConfigValidationError,
  type RiskLevel,
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
import { getBridgeToken, readRequestToken, validateToken, redactActionForLog } from "./security.js";
import { ApprovalTraceStore } from "./approval-trace.js";

const MAX_MACRO_ACTION_TEXT = 2000;

const VALID_EVENTS: Set<string> = new Set([
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
  "AskUserQuestion",
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
  if (key === "askuserquestion" || key === "ask_user_question" || key === "ask-user-question") return "AskUserQuestion";
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


export interface DeckyApp {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketIOServer;
  sm: StateMachine;
  /** Restore console.log/warn/error to the originals captured at module-load time. Call in test teardown. */
  restoreConsole: () => void;
}

// Capture true console originals at module-load time (before any createApp() interception).
// This prevents double-interception when createApp() is called more than once in the same process.
const _origConsoleLog = console.log.bind(console);
const _origConsoleWarn = console.warn.bind(console);
const _origConsoleError = console.error.bind(console);

type ApprovalFlow = "gate" | "mirror";

interface ApprovalQueueItem {
  id: string;
  flow: ApprovalFlow;
  nonce: string | null;
  sessionId: string | null;
  cwd: string | null;
  tool: string | null;
  riskLevel: RiskLevel | null;
  createdAt: number;
}

interface PlatformCapabilities {
  textInjection: boolean;
  approveInApp: boolean;
  dictation: boolean;
  platform: string;
}

const platformCapabilities: PlatformCapabilities = {
  textInjection: process.platform === "darwin" || process.platform === "win32" || process.platform === "linux",
  approveInApp: process.platform === "darwin" || process.platform === "win32" || process.platform === "linux",
  dictation: process.platform === "darwin",
  platform: process.platform,
};

interface SlotHeartbeatPayload {
  deviceId: string;
  model: string;
  rows: number;
  cols: number;
  buttonCount: number;
  activeSlots: Array<{ row: number; col: number; index: number; label?: string }>;
}

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
    riskLevel: RiskLevel | null;
    sessionId: string | null;
    cwd: string | null;
  } | null;
  question: {
    text: string | null;
    options: QuestionOption[];
  } | null;
  uptimeSeconds: number;
  deck: SlotHeartbeatPayload | null;
  sessionStats: { approves: number; denials: number };
}

interface LogEntry {
  ts: number;
  level: string;
  msg: string;
}

const LOG_BUFFER_MAX = 500;

/** Classify a tool name against configured risk rules (first match wins). */
function classifyToolRisk(toolName: string | null): RiskLevel | null {
  if (!toolName) return null;
  const rules = getToolRiskRules();
  for (const rule of rules) {
    try {
      if (new RegExp(rule.pattern, "i").test(toolName)) return rule.risk;
    } catch {
      // Invalid regex — skip
    }
  }
  return null;
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
  const startedAt = Date.now();
  const deckState = new Map<string, SlotHeartbeatPayload>();
  let lastHeartbeatDeviceId: string | null = null;
  const logBuffer: LogEntry[] = [];
  let pendingGateNonce: string | null = null;
  let pendingQuestion: { text: string | null; options: QuestionOption[] } | null = null;

  function pushLog(level: string, msg: string): void {
    if (logBuffer.length >= LOG_BUFFER_MAX) logBuffer.shift();
    const capped = msg.length > 4096 ? msg.slice(0, 4096) + "…[truncated]" : msg;
    logBuffer.push({ ts: Date.now(), level, msg: capped });
  }

  // Intercept console output so bridge log lines appear in GET /logs.
  // Uses module-level originals so multiple createApp() calls don't chain interceptors.
  console.log = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    pushLog("info", msg);
    _origConsoleLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    pushLog("warn", msg);
    _origConsoleWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    pushLog("error", msg);
    _origConsoleError(...args);
  };

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
    // Most recently heartbeated deck (or null)
    const deckEntry = lastHeartbeatDeviceId ? (deckState.get(lastHeartbeatDeviceId) ?? null) : null;
    return {
      ...snapshot,
      capabilities: platformCapabilities,
      approval: active
        ? {
          pending: approvalQueue.length,
          position: 1, // active is always approvalQueue[0]
          flow: active.flow,
          riskLevel: active.riskLevel,
          sessionId: active.sessionId,
          cwd: active.cwd,
        }
        : null,
      question: pendingQuestion,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      deck: deckEntry,
      sessionStats: approvalTrace.getSessionStats(),
    };
  }

  function emitState(snapshot = sm.getSnapshot()): void {
    io.emit("stateChange", statePayload(snapshot));
  }

  // Broadcast state changes to all connected Socket.io clients.
  // For PostToolUse, queue advancement (shift) is handled by applyHookPayload below.
  // For all other terminal-state transitions, clear the whole queue.
  sm.onStateChange((snapshot) => {
    const isTerminal =
      snapshot.state === "idle" ||
      snapshot.state === "stopped" ||
      snapshot.state === "done";
    if (isTerminal && snapshot.lastEvent !== "PostToolUse" && approvalQueue.length > 0) {
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
      sessionId?: string | null;
      cwd?: string | null;
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
      const sessionId = options?.sessionId ?? null;
      const cwd = options?.cwd ?? null;
      // Dedup: with a nonce, dedup by exact nonce (concurrent sessions use different nonces).
      // Without a nonce (legacy/simple hooks), fall back to single-queue mode (cap at 1).
      const toolName = payload.tool ?? null;
      const alreadyQueued = nonce != null
        ? approvalQueue.some((item) => item.nonce === nonce)
        : approvalQueue.length > 0;
      if (!alreadyQueued) {
        const queued = enqueueApprovalRequest({
          flow,
          nonce,
          sessionId,
          cwd,
          tool: toolName,
          riskLevel: classifyToolRisk(toolName),
        });
        // Surface the target app when this request becomes the active one
        if (getConfig().popUpApp && currentApproval()?.id === queued.id) {
          surfaceTargetApp("claude").catch((err) => {
            console.error("[queue] surfaceTargetApp on arrival failed:", err);
          });
        }
      }
    }
    // AskUserQuestion: store question/options for statePayload, clear on terminal events
    if (payload.event === "AskUserQuestion") {
      pendingQuestion = {
        text: payload.question ?? null,
        options: payload.options ?? [],
      };
    } else if (
      payload.event === "Stop" ||
      payload.event === "SubagentStop" ||
      payload.event === "PostToolUse"
    ) {
      pendingQuestion = null;
      clearQuestionResponse();
    }

    let snapshot = sm.processEvent(payload);

    if (payload.event === "PostToolUse") {
      // Advance the queue by one: the completed tool's approval slot is freed.
      // (Stop/SubagentStop queue clearing is handled by the sm.onStateChange listener.)
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

  app.use(express.json({ limit: "5mb" }));
  // CORS for REST endpoints — matches the Socket.io CORS policy above.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-decky-token, x-decky-event, x-decky-approval-flow, x-decky-nonce");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use((req, res, next) => {
    if (!validateToken(readRequestToken(req), bridgeToken)) {
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

    // Normalize options array for AskUserQuestion events (max 8, label ≤ 80 chars).
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    const normalizedOptions: QuestionOption[] = rawOptions
      .slice(0, 8)
      .map((o: unknown) => {
        if (!o || typeof o !== "object") return null;
        const opt = o as Record<string, unknown>;
        const label = typeof opt.label === "string" ? opt.label.trim().slice(0, 80) : "";
        if (!label) return null;
        return { label, ...(typeof opt.value === "string" ? { value: opt.value } : {}) };
      })
      .filter((o): o is QuestionOption => o !== null);
    const questionText = typeof body.question === "string" ? body.question : null;

    const payload: HookPayload = {
      event,
      tool: extractToolName(body),
      input: body.input,
      ...(event === "AskUserQuestion" ? { question: questionText ?? undefined, options: normalizedOptions } : {}),
      // Pass usage through for Stop/SubagentStop so rate limit tracking can read it.
      ...(body.usage && typeof body.usage === "object" ? { usage: body.usage } : {}),
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
    const rawNonce = typeof nonceHeader === "string" ? nonceHeader.trim() : "";
    const nonce =
      rawNonce.length > 0 && rawNonce.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(rawNonce)
        ? rawNonce
        : null;
    const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 256) : null;
    const cwd = typeof body.cwd === "string" ? body.cwd.slice(0, 1024) : null;
    const snapshot = applyHookPayload(payload, { approvalFlow, nonce, sessionId, cwd });
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

  app.get("/logs", (req, res) => {
    const rawLines = typeof req.query.lines === "string" ? Number(req.query.lines) : 50;
    const maxLines = Number.isFinite(rawLines) ? Math.max(1, Math.min(500, Math.floor(rawLines))) : 50;
    const level = typeof req.query.level === "string" ? req.query.level : "all";

    const validLevels = new Set(["all", "error", "warn"]);
    if (!validLevels.has(level)) {
      res.status(400).json({ error: `Invalid level '${level}'. Valid values: all, error, warn` });
      return;
    }

    let entries = logBuffer.slice();
    if (level === "error") {
      entries = entries.filter((e) => e.level === "error");
    } else if (level === "warn") {
      entries = entries.filter((e) => e.level === "error" || e.level === "warn");
    }
    const sliced = entries.slice(-maxLines);
    const lines = sliced.map((e) => `[${new Date(e.ts).toISOString()}] [${e.level}] ${e.msg}`);
    res.json({ lines });
  });

  app.get("/config", (_req, res) => {
    res.json({ ...getConfig(), readOnly: isReadOnly() });
  });

  app.put("/config", (req, res) => {
    if (isReadOnly()) {
      res.status(403).json({ error: "Bridge is in read-only mode. Set readOnly: false in config or DECKY_READONLY=0 to override." });
      return;
    }
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
    const config = loadConfig();
    io.emit("configUpdate", config);
    res.json({ ok: true, config });
  });

  // --- Socket.io connections ---

  io.on("connection", (socket) => {
    const token =
      (typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token.trim() : "") ||
      (typeof socket.handshake.headers["x-decky-token"] === "string"
        ? socket.handshake.headers["x-decky-token"].trim()
        : "");
    if (!validateToken(token, bridgeToken)) {
      socket.emit("error", { error: "Unauthorized" });
      socket.disconnect(true);
      return;
    }
    console.log(`[io] client connected: ${socket.id}`);

    socket.emit("stateChange", statePayload());
    socket.emit("configUpdate", getConfig());

    const ACTION_THROTTLE_MS = 200;
    const THROTTLE_EXEMPT = new Set(["approve", "deny", "cancel", "restart", "approveOnceInClaude", "selectOption", "requestState"]);
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
        const activeFlow = activeApproval?.flow ?? "gate";
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
            { state: currentState, approvalFlow: activeFlow },
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
          approveOnceInClaude().catch((err) => {
            console.error("[io] approveOnceInClaude failed:", err);
            socket.emit("error", { error: "Failed to activate Claude for approve once" });
          });
        }
      } else if (data.action === "selectOption") {
        // User selected an option from an AskUserQuestion prompt.
        // Write the index to the response file so the polling hook can read it.
        const currentState = sm.getSnapshot().state;
        if (currentState !== "asking") {
          socket.emit("error", { error: "selectOption ignored: not in asking state" });
          return;
        }
        const rawIndex = data.index;
        if (typeof rawIndex !== "number" || !Number.isInteger(rawIndex) || rawIndex < 0) {
          socket.emit("error", { error: "selectOption requires a non-negative integer index" });
          return;
        }
        const optionCount = pendingQuestion?.options.length ?? 0;
        if (rawIndex >= optionCount) {
          socket.emit("error", { error: `selectOption index ${rawIndex} out of range (${optionCount} options)` });
          return;
        }
        writeQuestionResponse(rawIndex);
        pendingQuestion = null;
        sm.forceState("idle", "option selected via StreamDeck");
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
        const currentConfig = getConfig();
        const theme = typeof data.theme === "string"
          ? normalizeTheme(data.theme, currentConfig.theme)
          : undefined;
        let themeSeed =
          typeof data.themeSeed === "number" && Number.isFinite(data.themeSeed)
            ? Math.floor(data.themeSeed)
            : undefined;
        let colors = data.colors && typeof data.colors === "object" ? data.colors : undefined;
        const defaultTargetApp =
          typeof data.defaultTargetApp === "string" && VALID_TARGET_APPS.has(data.defaultTargetApp)
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
      } else if (data.action === "requestState") {
        socket.emit("stateChange", statePayload());
      } else {
        console.log(`[io] unknown action: ${data.action}`);
      }
    });

    socket.on("slotHeartbeat", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as Record<string, unknown>;

      // Validate and sanitize before storing — this data is forwarded to GET /status.
      const rawDeviceId = typeof p.deviceId === "string" ? p.deviceId.trim() : "unknown";
      const deviceId = rawDeviceId.slice(0, 128) || "unknown";
      const rows = typeof p.rows === "number" && Number.isFinite(p.rows) ? Math.max(0, Math.floor(p.rows)) : 0;
      const cols = typeof p.cols === "number" && Number.isFinite(p.cols) ? Math.max(0, Math.floor(p.cols)) : 0;
      const buttonCount = rows * cols;
      const model = typeof p.model === "string" ? p.model.slice(0, 64) : "unknown";

      const rawSlots = Array.isArray(p.activeSlots) ? p.activeSlots : [];
      const activeSlots = rawSlots.slice(0, 256).flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const slot = s as Record<string, unknown>;
        const row = typeof slot.row === "number" ? Math.floor(slot.row) : -1;
        const col = typeof slot.col === "number" ? Math.floor(slot.col) : -1;
        const index = typeof slot.index === "number" ? Math.floor(slot.index) : -1;
        if (row < 0 || col < 0 || index < 0 || (rows > 0 && cols > 0 && index >= rows * cols)) return [];
        const entry: SlotHeartbeatPayload["activeSlots"][number] = { row, col, index };
        if (typeof slot.label === "string") entry.label = slot.label.slice(0, 64);
        return [entry];
      });

      const sanitized: SlotHeartbeatPayload = { deviceId, model, rows, cols, buttonCount, activeSlots };
      deckState.set(deviceId, sanitized);
      lastHeartbeatDeviceId = deviceId;
    });

    socket.on("disconnect", () => {
      console.log(`[io] client disconnected: ${socket.id}`);
    });
  });

  function restoreConsole(): void {
    console.log = _origConsoleLog;
    console.warn = _origConsoleWarn;
    console.error = _origConsoleError;
  }

  return { app, httpServer, io, sm, restoreConsole };
}
