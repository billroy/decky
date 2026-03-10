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
  setApprovalAttemptLogger,
  startDictationForClaude,
  withApprovalAttemptContext,
} from "./macro-exec.js";
import { getBridgeToken, readRequestToken, redactActionForLog } from "./security.js";
import { CodexMonitor } from "./codex-monitor.js";
import {
  CodexAppServerProvider,
  type CodexApprovalDecision,
  type CodexAppServerHookEvent,
} from "./codex-app-server-provider.js";
import { ApprovalTraceStore } from "./approval-trace.js";

const MAX_MACRO_ACTION_TEXT = 2000;
const MIRROR_SETTLE_TIMEOUT_MS = 8000;

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
type HookSource = "hook" | "codex-monitor";
type CodexIntegrationMode = "sqlite" | "app-server";

interface ApprovalQueueItem {
  id: string;
  requestId: string | null;
  flow: ApprovalFlow;
  targetApp: ApprovalTargetApp;
  nonce: string | null;
  tool: string | null;
  source: HookSource;
  createdAt: number;
}

interface StatePayload {
  state: string;
  previousState: string | null;
  tool: string | null;
  lastEvent: string | null;
  timestamp: number;
  approval: {
    pending: number;
    position: number;
    targetApp: ApprovalTargetApp;
    flow: ApprovalFlow;
    requestId: string;
  } | null;
}

interface CodexCompareEvent {
  seq: number;
  source: "primary" | "shadow";
  event: HookEvent;
  tool: string | null;
  requestId: string | null;
  timestamp: number;
}

interface CodexCompareDivergence {
  seq: number;
  index: number;
  primary: string;
  shadow: string;
  timestamp: number;
}

function parseApprovalTargetApp(value: unknown): ApprovalTargetApp {
  return value === "codex" ? "codex" : "claude";
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

function parseCodexIntegrationMode(value: unknown): CodexIntegrationMode {
  const requested = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (requested === "sqlite") {
    if (process.env.DECKY_ENABLE_CODEX_SQLITE === "1") return "sqlite";
    console.warn(
      "[codex] sqlite integration is disabled by default; set DECKY_ENABLE_CODEX_SQLITE=1 to re-enable",
    );
  }
  return "app-server";
}

function parseOptionalEnvString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isCodexAppServerHookEvent(event: HookPayload | CodexAppServerHookEvent): event is CodexAppServerHookEvent {
  const candidate = event as Record<string, unknown>;
  const payload = candidate.payload;
  if (!payload || typeof payload !== "object") return false;
  return typeof (payload as Record<string, unknown>).event === "string";
}

export function createApp(): DeckyApp {
  const app = express();
  const httpServer = createServer(app);
  const bridgeToken = getBridgeToken();
  const approvalTrace = new ApprovalTraceStore();
  const approvalQueue: ApprovalQueueItem[] = [];
  let pendingGateNonce: string | null = null;
  let pendingApprovalFlow: ApprovalFlow = "gate";
  let pendingApprovalTargetApp: ApprovalTargetApp = "claude";
  let pendingMirrorSettlement:
    | { actionId: string; socketId: string; timer: NodeJS.Timeout; reason: "approve" | "dismiss" }
    | null = null;
  let codexCompareSeq = 0;
  const codexComparePrimary: CodexCompareEvent[] = [];
  const codexCompareShadow: CodexCompareEvent[] = [];
  const codexCompareDivergences: CodexCompareDivergence[] = [];

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

  function trimCompareBuffers(): void {
    const maxEvents = 200;
    const maxDivergences = 120;
    if (codexComparePrimary.length > maxEvents) {
      codexComparePrimary.splice(0, codexComparePrimary.length - maxEvents);
    }
    if (codexCompareShadow.length > maxEvents) {
      codexCompareShadow.splice(0, codexCompareShadow.length - maxEvents);
    }
    if (codexCompareDivergences.length > maxDivergences) {
      codexCompareDivergences.splice(0, codexCompareDivergences.length - maxDivergences);
    }
  }

  function compareSignature(event: CodexCompareEvent): string {
    return `${event.event}:${event.tool ?? ""}`;
  }

  function recordCodexCompareEvent(source: "primary" | "shadow", payload: HookPayload, requestId: string | null): void {
    const event: CodexCompareEvent = {
      seq: ++codexCompareSeq,
      source,
      event: payload.event,
      tool: payload.tool ?? null,
      requestId,
      timestamp: Date.now(),
    };
    const own = source === "primary" ? codexComparePrimary : codexCompareShadow;
    const other = source === "primary" ? codexCompareShadow : codexComparePrimary;
    own.push(event);

    const index = own.length - 1;
    const counterpart = other[index];
    if (counterpart) {
      const ownSig = compareSignature(event);
      const otherSig = compareSignature(counterpart);
      if (ownSig !== otherSig) {
        codexCompareDivergences.push({
          seq: event.seq,
          index,
          primary: source === "primary" ? ownSig : otherSig,
          shadow: source === "shadow" ? ownSig : otherSig,
          timestamp: Date.now(),
        });
      }
    }
    trimCompareBuffers();
  }

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
    pendingApprovalTargetApp = active.targetApp;
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

  function shiftApprovalRequest(requestId: string | null = null): ApprovalQueueItem | null {
    if (approvalQueue.length === 0) return null;
    if (!requestId) {
      const removed = approvalQueue.shift() ?? null;
      applyPendingFromQueue();
      return removed;
    }
    const idx = approvalQueue.findIndex((entry) => entry.requestId === requestId);
    if (idx < 0) return null;
    const [removed] = approvalQueue.splice(idx, 1);
    applyPendingFromQueue();
    return removed;
  }

  function statePayload(snapshot = sm.getSnapshot()): StatePayload {
    const active = currentApproval();
    return {
      ...snapshot,
      approval: active
        ? {
          pending: approvalQueue.length,
          position: 1,
          targetApp: active.targetApp,
          flow: active.flow,
          requestId: active.requestId ?? active.id,
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
      clearPendingMirrorSettlement(`state=${snapshot.state} queue reset`);
    }
    emitState(snapshot);
  });

  function clearPendingMirrorSettlement(reason?: string): void {
    if (!pendingMirrorSettlement) return;
    clearTimeout(pendingMirrorSettlement.timer);
    if (reason) {
      approvalTrace.append(
        pendingMirrorSettlement.actionId,
        "settlement",
        "pending settlement cleared",
        { reason },
      );
    }
    pendingMirrorSettlement = null;
  }

  function startMirrorSettlement(actionId: string, socketId: string, reason: "approve" | "dismiss"): void {
    clearPendingMirrorSettlement("replaced by newer action");
    const timer = setTimeout(() => {
      if (!pendingMirrorSettlement || pendingMirrorSettlement.actionId !== actionId) return;
      const snap = sm.getSnapshot();
      approvalTrace.append(actionId, "settlement.timeout", "no monitor settlement observed", {
        state: snap.state,
        timeoutMs: MIRROR_SETTLE_TIMEOUT_MS,
        reason: pendingMirrorSettlement.reason,
      });
      approvalTrace.settle({
        actionId,
        status: "timed-out",
        finalState: snap.state,
        finalReason: "timeout waiting for codex monitor settlement",
      });
      io.to(socketId).emit("error", {
        error:
          pendingMirrorSettlement.reason === "approve"
            ? "Approve timed out waiting for Codex settlement"
            : "Dismiss timed out waiting for Codex settlement",
      });
      if (snap.state === "awaiting-approval") {
        if (pendingMirrorSettlement.reason === "approve") {
          // Fallback reconciliation: if monitor events are delayed/missed, avoid
          // wedging the deck in awaiting-approval and continue the execution flow.
          sm.forceState("tool-executing", "approve timed out via StreamDeck (fallback)");
        } else {
          sm.forceState("stopped", "dismiss timed out via StreamDeck");
        }
      }
      shiftApprovalRequest();
      const next = currentApproval();
      if (next) {
        sm.forceState("awaiting-approval", "queued approval pending", next.tool);
      } else {
        emitState();
      }
      clearPendingMirrorSettlement("timeout");
    }, MIRROR_SETTLE_TIMEOUT_MS);
    pendingMirrorSettlement = { actionId, socketId, timer, reason };
    approvalTrace.setStatus(actionId, "settling", "waiting for codex monitor settlement", {
      timeoutMs: MIRROR_SETTLE_TIMEOUT_MS,
      reason,
    });
  }

  function applyHookPayload(
    payload: HookPayload,
    options?: {
      approvalFlow?: ApprovalFlow;
      nonce?: string | null;
      targetApp?: ApprovalTargetApp;
      source?: HookSource;
      requestId?: string | null;
    },
  ) {
    const source = options?.source ?? "hook";
    const requestId = options?.requestId ?? null;
    // Clear any stale gate file when a new tool-approval cycle starts
    if (payload.event === "PreToolUse") {
      clearGateFile();
      const flow = options?.approvalFlow ?? "gate";
      const targetApp = options?.targetApp ?? "claude";
      const nonce = options?.nonce ?? null;
      const current = sm.getSnapshot();
      const duplicateHookPre = source === "hook" && current.state === "awaiting-approval";
      const duplicateMonitorPre =
        source === "codex-monitor" &&
        requestId !== null &&
        approvalQueue.some((entry) => entry.requestId === requestId);
      if (!duplicateHookPre && !duplicateMonitorPre) {
        enqueueApprovalRequest({
          requestId,
          flow,
          targetApp,
          nonce,
          tool: payload.tool ?? null,
          source,
        });
      }
    }
    let snapshot = sm.processEvent(payload);

    if (pendingMirrorSettlement && source === "codex-monitor") {
      approvalTrace.append(
        pendingMirrorSettlement.actionId,
        "codex.monitor",
        `monitor event ${payload.event}`,
        {
          tool: payload.tool ?? null,
          state: snapshot.state,
          previousState: snapshot.previousState,
        },
      );
      if (payload.event !== "PreToolUse") {
        shiftApprovalRequest(requestId);
        const next = currentApproval();
        if (next && snapshot.state !== "awaiting-approval") {
          snapshot = sm.forceState("awaiting-approval", "queued approval pending", next.tool);
        } else {
          emitState(snapshot);
        }
        approvalTrace.settle({
          actionId: pendingMirrorSettlement.actionId,
          status: "settled",
          finalState: snapshot.state,
          finalReason: `codex monitor ${payload.event}`,
        });
        clearPendingMirrorSettlement("settled by monitor event");
      }
    }

    if (
      source === "codex-monitor" &&
      !pendingMirrorSettlement &&
      (payload.event === "PostToolUse" || payload.event === "Stop" || payload.event === "SubagentStop")
    ) {
      const shifted = shiftApprovalRequest(requestId);
      if (shifted) {
        const next = currentApproval();
        if (next && snapshot.state !== "awaiting-approval") {
          snapshot = sm.forceState("awaiting-approval", "queued approval pending", next.tool);
        } else {
          emitState(snapshot);
        }
      }
    }

    if (
      source === "hook" &&
      (payload.event === "PostToolUse" || payload.event === "Stop" || payload.event === "SubagentStop")
    ) {
      const active = currentApproval();
      if (active) {
        const toolMatches = !payload.tool || !active.tool || payload.tool === active.tool;
        if (toolMatches) {
          shiftApprovalRequest();
          const next = currentApproval();
          if (next && snapshot.state !== "awaiting-approval") {
            snapshot = sm.forceState("awaiting-approval", "queued approval pending", next.tool);
          } else {
            emitState(snapshot);
          }
        }
      }
    }

    if (payload.event === "PreToolUse" && approvalQueue.length > 1) {
      // State may remain "awaiting-approval" with no transition callback, but
      // queue metadata changed and the plugin should reflect it.
      emitState(snapshot);
    }

    return snapshot;
  }

  const isTestRuntime =
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    (process.env.DECKY_HOME ?? "").includes(".decky-test");
  const codexMonitorEnabled = !isTestRuntime && process.env.DECKY_ENABLE_CODEX_MONITOR !== "0";
  const codexIntegrationMode = parseCodexIntegrationMode(process.env.DECKY_CODEX_INTEGRATION);
  const codexCompareEnabled =
    codexIntegrationMode === "app-server" &&
    process.env.DECKY_CODEX_COMPARE_MODE === "1" &&
    process.env.DECKY_ENABLE_CODEX_SQLITE === "1";
  const codexAppServerCommand = parseOptionalEnvString(process.env.DECKY_CODEX_APP_SERVER_COMMAND);
  let codexMonitor: { start: () => Promise<boolean>; stop: () => void } | null = null;
  let codexShadowMonitor: CodexMonitor | null = null;
  let resolveCodexApproval: ((requestId: string, decision: CodexApprovalDecision) => Promise<void>) | null = null;
  if (codexMonitorEnabled) {
    const onCodexHookEvent = (event: HookPayload | CodexAppServerHookEvent) => {
      const payload = isCodexAppServerHookEvent(event) ? event.payload : event;
      const requestId = isCodexAppServerHookEvent(event) ? event.requestId : null;
      if (codexCompareEnabled) {
        recordCodexCompareEvent("primary", payload, requestId ?? null);
      }
      const opts =
        payload.event === "PreToolUse"
          ? {
            approvalFlow: "mirror" as const,
            nonce: null,
            targetApp: "codex" as const,
            source: "codex-monitor" as const,
            requestId: requestId ?? null,
          }
          : {
            source: "codex-monitor" as const,
            requestId: requestId ?? null,
          };
      applyHookPayload(payload, opts);
    };

    if (codexIntegrationMode === "app-server") {
      const codexAppServer = new CodexAppServerProvider({
        command: codexAppServerCommand,
        onHookEvent: (event) => onCodexHookEvent(event),
        onError: (error) => {
          console.warn("[codex-app-server] error:", error);
        },
        onDebugLog: (message) => {
          console.log(`[codex-app-server] ${message}`);
        },
      });
      codexMonitor = codexAppServer;
      resolveCodexApproval = (requestId, decision) => codexAppServer.resolveApproval(requestId, decision);
      if (codexCompareEnabled) {
        codexShadowMonitor = new CodexMonitor({
          onHookEvent: (payload) => {
            recordCodexCompareEvent("shadow", payload, null);
          },
          onError: (error) => {
            console.warn("[codex-monitor-shadow] poll error:", error);
          },
        });
      }
    } else {
      codexMonitor = new CodexMonitor({
        onHookEvent: (payload) => onCodexHookEvent(payload),
        onError: (error) => {
          console.warn("[codex-monitor] poll error:", error);
        },
      });
    }

    void codexMonitor.start().then((started) => {
      if (!started) {
        console.warn(`[codex] failed to start integration provider (mode=${codexIntegrationMode})`);
        return;
      }
      if (codexIntegrationMode === "app-server") {
        console.log("[codex-app-server] connected using app-server stdio transport");
        if (codexCompareEnabled && codexShadowMonitor) {
          void codexShadowMonitor.start().then((shadowStarted) => {
            if (shadowStarted) {
              console.log("[codex-monitor-shadow] sqlite compare mode enabled");
            } else {
              console.warn("[codex-monitor-shadow] compare mode requested, sqlite source unavailable");
            }
          });
        }
      } else {
        console.log("[codex-monitor] mirroring Codex approval events from state DB");
      }
    });
    httpServer.on("close", () => {
      codexMonitor?.stop();
      codexShadowMonitor?.stop();
    });
  }
  httpServer.on("close", () => {
    clearPendingMirrorSettlement("server closed");
    setApprovalAttemptLogger(null);
  });

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
    res.json({ ok: true, state: statePayload(snapshot) });
  });

  app.get("/status", (_req, res) => {
    res.json(statePayload());
  });

  app.get("/debug/approval-trace", (req, res) => {
    const raw = typeof req.query.limit === "string" ? Number(req.query.limit) : 25;
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.floor(raw))) : 25;
    res.json({
      traces: approvalTrace.list(limit),
      codexIntegrationMode,
      pendingMirrorSettlement: pendingMirrorSettlement
        ? { actionId: pendingMirrorSettlement.actionId, socketId: pendingMirrorSettlement.socketId }
        : null,
      approvalQueue: approvalQueue.map((entry, idx) => ({
        id: entry.id,
        requestId: entry.requestId,
        index: idx + 1,
        flow: entry.flow,
        targetApp: entry.targetApp,
        tool: entry.tool,
        source: entry.source,
        createdAt: entry.createdAt,
      })),
      now: Date.now(),
    });
  });

  app.get("/debug/codex-compare", (_req, res) => {
    res.json({
      enabled: codexCompareEnabled,
      mode: codexIntegrationMode,
      primaryEvents: codexComparePrimary,
      shadowEvents: codexCompareShadow,
      divergences: codexCompareDivergences,
      counts: {
        primary: codexComparePrimary.length,
        shadow: codexCompareShadow.length,
        divergences: codexCompareDivergences.length,
      },
      now: Date.now(),
    });
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

    socket.emit("stateChange", statePayload());
    socket.emit("configUpdate", getConfig());

    socket.on("action", (data: { action: string; [key: string]: unknown }) => {
      const actionId = normalizeActionId(data.actionId) ?? createActionId("sd");
      console.log(`[io] action received: ${JSON.stringify(redactActionForLog(data as Record<string, unknown>))}`);

      const validActions: Record<string, { result: ApprovalResult; state: string; reason: string }> = {
        approve: { result: "approve", state: "tool-executing", reason: "approved via StreamDeck" },
        deny:    { result: "deny",    state: "thinking",       reason: "denied via StreamDeck" },
        cancel:  { result: "cancel",  state: "stopped",        reason: "cancelled via StreamDeck" },
      };

      const entry = validActions[data.action];
      if (entry) {
        const currentState = sm.getSnapshot().state;
        const activeApproval = currentApproval();
        const activeFlow = activeApproval?.flow ?? pendingApprovalFlow;
        const activeRequestId = activeApproval?.requestId ?? null;
        const approvalTargetApp =
          activeApproval?.targetApp === "codex" || pendingApprovalTargetApp === "codex"
            ? "codex"
            : parseApprovalTargetApp(data.targetApp);
        approvalTrace.start({ actionId, action: data.action, targetApp: approvalTargetApp });
        approvalTrace.append(actionId, "bridge.action.received", "approval action received", {
          action: data.action,
          state: currentState,
          pendingApprovalFlow: activeFlow,
          pendingApprovalTargetApp: activeApproval?.targetApp ?? pendingApprovalTargetApp,
          resolvedTargetApp: approvalTargetApp,
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
          if (pendingMirrorSettlement?.actionId === actionId) {
            clearPendingMirrorSettlement("failed");
          }
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
          if (approvalTargetApp === "claude") {
            withApprovalAttemptContext(actionId, () => dismissClaudeApproval()).catch((err) => {
              console.error("[io] cancel action failed outside approval state:", err);
              socket.emit("error", { error: "Failed to dismiss Claude" });
            });
          } else {
            withApprovalAttemptContext(actionId, () => dismissApprovalInTargetApp(approvalTargetApp)).catch((err) => {
              console.error("[io] cancel action failed outside approval state:", err);
              socket.emit("error", { error: "Failed to dismiss Codex" });
            });
          }
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
        if (activeFlow === "mirror") {
          pendingGateNonce = null;
          if (entry.result === "approve") {
            if (approvalTargetApp === "claude") {
              withApprovalAttemptContext(actionId, () => approveOnceInClaude()).catch((err) => {
                console.error("[io] approve action failed in mirror flow:", err);
                settleFailed("Failed to approve in Claude", "approve action failed in mirror flow");
              });
            } else {
              startMirrorSettlement(actionId, socket.id, "approve");
              if (resolveCodexApproval && activeRequestId) {
                withApprovalAttemptContext(
                  actionId,
                  () => resolveCodexApproval(activeRequestId, "approve"),
                ).catch((err) => {
                  console.error("[io] approve action failed in app-server flow:", err);
                  settleFailed("Failed to approve in Codex", "approve action failed in app-server flow");
                });
              } else if (codexIntegrationMode === "app-server") {
                settleFailed(
                  "Failed to approve in Codex (missing app-server request ID)",
                  "approve action missing codex app-server request correlation",
                );
              } else {
                withApprovalAttemptContext(actionId, () => approveInTargetApp(approvalTargetApp)).catch((err) => {
                  console.error("[io] approve action failed in mirror flow:", err);
                  settleFailed("Failed to approve in Codex", "approve action failed in mirror flow");
                });
              }
            }
            approvalTrace.setStatus(actionId, "settling", "mirror approve dispatched");
          } else {
            if (approvalTargetApp === "claude") {
              const mirrorDismissReason = `${entry.result} via StreamDeck (mirror)`;
              withApprovalAttemptContext(actionId, () => dismissClaudeApproval()).then(() => {
                shiftApprovalRequest();
                const next = currentApproval();
                if (next) {
                  sm.forceState("awaiting-approval", "queued approval pending", next.tool);
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
            } else {
              // For Codex mirror flow, rely on mirrored Codex events to advance state
              // so the Deck never reports idle before the host app actually settles.
              startMirrorSettlement(actionId, socket.id, "dismiss");
              if (resolveCodexApproval && activeRequestId) {
                withApprovalAttemptContext(
                  actionId,
                  () => resolveCodexApproval(activeRequestId, entry.result === "cancel" ? "cancel" : "deny"),
                ).then(() => {
                  approvalTrace.append(actionId, "bridge.dismiss.dispatched", "dismiss sent to codex app-server", {
                    targetApp: approvalTargetApp,
                    requestId: activeRequestId,
                  });
                }).catch((err) => {
                  console.error("[io] deny/cancel action failed in app-server flow:", err);
                  settleFailed("Failed to dismiss Codex approval", "deny/cancel action failed in app-server flow");
                });
              } else if (codexIntegrationMode === "app-server") {
                settleFailed(
                  "Failed to dismiss Codex approval (missing app-server request ID)",
                  "deny/cancel action missing codex app-server request correlation",
                );
              } else {
                withApprovalAttemptContext(actionId, () => dismissApprovalInTargetApp(approvalTargetApp)).then(() => {
                  approvalTrace.append(actionId, "bridge.dismiss.dispatched", "dismiss sent to codex host", {
                    targetApp: approvalTargetApp,
                  });
                }).catch((err) => {
                  console.error("[io] deny/cancel action failed in mirror flow:", err);
                  settleFailed("Failed to dismiss Codex approval", "deny/cancel action failed in mirror flow");
                });
              }
            }
          }
          return;
        }
        writeGateFile(entry.result, pendingGateNonce ?? undefined);
        pendingGateNonce = null;
        shiftApprovalRequest();
        const next = currentApproval();
        if (next) {
          sm.forceState("awaiting-approval", "queued approval pending", next.tool);
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
