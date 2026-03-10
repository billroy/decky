import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import type { HookPayload } from "./state-machine.js";

export type CodexApprovalDecision = "approve" | "deny" | "cancel";
export type JsonRpcRequestId = string | number;
export type CodexAppServerLifecycleState =
  | "starting"
  | "spawned"
  | "handshake-sent"
  | "ready"
  | "start-failed"
  | "error"
  | "exit"
  | "stopped";

export interface CodexAppServerLifecycleEvent {
  state: CodexAppServerLifecycleState;
  at: number;
  detail?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
}

const PUBLIC_REQUEST_PREFIX = "jsonrpc:";
const INIT_REQUEST_ID = "decky-init";
const AUTO_RESUME_LOADED_LIST_REQUEST_ID = "decky-thread-loaded-list";
const AUTO_RESUME_LIST_REQUEST_ID = "decky-thread-list";
const AUTO_RESUME_RESUME_REQUEST_PREFIX = "decky-thread-resume:";

interface JsonRpcRequest {
  id: JsonRpcRequestId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: JsonRpcRequestId;
  result?: unknown;
  error?: unknown;
}

interface PendingApproval {
  publicRequestId: string;
  requestId: JsonRpcRequestId;
  method: string;
  tool: string;
  itemId: string | null;
}

interface AutoResumeThread {
  id: string;
  cwd: string | null;
  statusType: string | null;
  activeFlags: Set<string>;
}

export interface CodexAppServerHookEvent {
  payload: HookPayload;
  requestId: string | null;
}

export interface CodexAppServerSessionOptions {
  onHookEvent: (event: CodexAppServerHookEvent) => void;
  onOutgoingMessage?: (message: Record<string, unknown>) => void;
  onDebugLog?: (message: string) => void;
  onHandshakeReady?: () => void;
  onError?: (error: unknown) => void;
  clientInfo?: {
    name: string;
    version: string;
  };
  autoResumeCwd?: string | null;
}

export interface CodexAppServerProviderOptions extends CodexAppServerSessionOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  onDebugLog?: (message: string) => void;
  autoResumeCwd?: string | null;
  onLifecycle?: (event: CodexAppServerLifecycleEvent) => void;
}

const COMMAND_APPROVAL_METHOD = "item/commandExecution/requestApproval";
const FILE_CHANGE_APPROVAL_METHOD = "item/fileChange/requestApproval";
const LEGACY_COMMAND_APPROVAL_METHOD = "execCommandApproval";
const LEGACY_PATCH_APPROVAL_METHOD = "applyPatchApproval";
const DEFAULT_CODEX_APP_PATH = "/Applications/Codex.app/Contents/Resources/codex";

const APPROVAL_METHODS = new Set<string>([
  COMMAND_APPROVAL_METHOD,
  FILE_CHANGE_APPROVAL_METHOD,
  LEGACY_COMMAND_APPROVAL_METHOD,
  LEGACY_PATCH_APPROVAL_METHOD,
]);

export function resolveDefaultCodexAppServerCommand(
  pathExists: (path: string) => boolean = existsSync,
): string {
  if (pathExists(DEFAULT_CODEX_APP_PATH)) return DEFAULT_CODEX_APP_PATH;
  return "codex";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isRequestId(value: unknown): value is JsonRpcRequestId {
  return typeof value === "string" || typeof value === "number";
}

function encodeRequestKey(id: JsonRpcRequestId): string {
  return `${typeof id}:${String(id)}`;
}

export function toPublicRequestId(id: JsonRpcRequestId): string {
  return `${PUBLIC_REQUEST_PREFIX}${encodeRequestKey(id)}`;
}

function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  const obj = asRecord(msg);
  return !!obj && isRequestId(obj.id) && typeof obj.method === "string";
}

function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
  const obj = asRecord(msg);
  return !!obj && isRequestId(obj.id) && ("result" in obj || "error" in obj) && !("method" in obj);
}

function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
  const obj = asRecord(msg);
  return !!obj && typeof obj.method === "string" && !("id" in obj);
}

function parseItemId(params: unknown): string | null {
  const obj = asRecord(params);
  if (!obj) return null;
  return typeof obj.itemId === "string" ? obj.itemId : null;
}

function parseAutoResumeThread(value: unknown): AutoResumeThread | null {
  const obj = asRecord(value);
  if (!obj || typeof obj.id !== "string" || obj.id.trim().length === 0) return null;
  const statusObj = asRecord(obj.status);
  const activeFlags = new Set<string>();
  if (statusObj && Array.isArray(statusObj.activeFlags)) {
    for (const flag of statusObj.activeFlags) {
      if (typeof flag === "string" && flag.trim().length > 0) activeFlags.add(flag);
    }
  }
  return {
    id: obj.id,
    cwd: typeof obj.cwd === "string" ? obj.cwd : null,
    statusType: statusObj && typeof statusObj.type === "string" ? statusObj.type : null,
    activeFlags,
  };
}

function selectPreferredAutoResumeThread(threads: AutoResumeThread[], cwd: string | null): AutoResumeThread | null {
  if (threads.length === 0) return null;
  let best: { thread: AutoResumeThread; score: number } | null = null;
  for (const thread of threads) {
    let score = 0;
    if (cwd && thread.cwd === cwd) score += 100;
    if (thread.statusType === "active") score += 30;
    if (thread.activeFlags.has("waitingOnApproval")) score += 20;
    if (thread.activeFlags.has("waitingOnUserInput")) score += 10;
    if (!best || score > best.score) best = { thread, score };
  }
  return best?.thread ?? threads[0];
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferToolFromCommandActions(params: Record<string, unknown>): string | null {
  const actions = params.commandActions;
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const first = asRecord(actions[0]);
  if (!first) return null;
  if (typeof first.name === "string" && first.name.trim().length > 0) {
    return titleCase(first.name.trim());
  }
  const actionType = typeof first.type === "string" ? first.type : null;
  if (actionType === "read") return "Read";
  if (actionType === "listFiles") return "List Files";
  if (actionType === "search") return "Search";
  return null;
}

export function inferToolFromApprovalRequest(method: string, params: unknown): string {
  if (method === FILE_CHANGE_APPROVAL_METHOD || method === LEGACY_PATCH_APPROVAL_METHOD) {
    return "Write";
  }
  const obj = asRecord(params);
  if (!obj) return "Command";
  const fromActions = inferToolFromCommandActions(obj);
  if (fromActions) return fromActions;
  return "Command";
}

export function mapApprovalDecisionToResult(method: string, decision: CodexApprovalDecision): unknown {
  if (method === COMMAND_APPROVAL_METHOD || method === FILE_CHANGE_APPROVAL_METHOD) {
    return { decision: decision === "approve" ? "accept" : decision === "deny" ? "decline" : "cancel" };
  }
  if (method === LEGACY_COMMAND_APPROVAL_METHOD || method === LEGACY_PATCH_APPROVAL_METHOD) {
    return { decision: decision === "approve" ? "approved" : decision === "deny" ? "denied" : "abort" };
  }
  throw new Error(`Unsupported approval method: ${method}`);
}

export class CodexAppServerSession {
  private readonly onHookEvent: (event: CodexAppServerHookEvent) => void;
  private readonly onOutgoingMessage: (message: Record<string, unknown>) => void;
  private readonly onDebugLog: (message: string) => void;
  private readonly onHandshakeReady: () => void;
  private readonly onError: (error: unknown) => void;
  private readonly clientInfo: { name: string; version: string };
  private readonly autoResumeCwd: string | null;

  private handshakeInitializedSent = false;
  private pendingByRequestId = new Map<string, PendingApproval>();
  private pendingByItemId = new Map<string, string>();
  private autoResumeLoadedThreadIds: Set<string> | null = null;

  constructor(options: CodexAppServerSessionOptions) {
    this.onHookEvent = options.onHookEvent;
    this.onOutgoingMessage = options.onOutgoingMessage ?? (() => undefined);
    this.onDebugLog = options.onDebugLog ?? (() => undefined);
    this.onHandshakeReady = options.onHandshakeReady ?? (() => undefined);
    this.onError = options.onError ?? ((error) => console.warn("[codex-app-server] session error:", error));
    this.clientInfo = options.clientInfo ?? { name: "decky-bridge", version: "0.1.0" };
    this.autoResumeCwd = typeof options.autoResumeCwd === "string" && options.autoResumeCwd.trim().length > 0
      ? options.autoResumeCwd.trim()
      : null;
  }

  startHandshake(): void {
    this.onOutgoingMessage({
      id: INIT_REQUEST_ID,
      method: "initialize",
      params: {
        clientInfo: this.clientInfo,
        capabilities: {
          experimentalApi: true,
        },
      },
    });
  }

  stop(): void {
    this.pendingByRequestId.clear();
    this.pendingByItemId.clear();
    this.autoResumeLoadedThreadIds = null;
    this.handshakeInitializedSent = false;
  }

  pendingCount(): number {
    return this.pendingByRequestId.size;
  }

  ingestMessage(message: unknown): void {
    if (isJsonRpcRequest(message)) {
      this.handleRequest(message);
      return;
    }
    if (isJsonRpcResponse(message)) {
      this.handleResponse(message);
      return;
    }
    if (isJsonRpcNotification(message)) {
      this.handleNotification(message);
    }
  }

  async resolveApproval(publicRequestId: string, decision: CodexApprovalDecision): Promise<void> {
    const pending = this.pendingByRequestId.get(publicRequestId);
    if (!pending) {
      throw new Error(`No pending Codex approval request found for ${publicRequestId}`);
    }
    const result = mapApprovalDecisionToResult(pending.method, decision);
    this.onOutgoingMessage({
      id: pending.requestId,
      result,
    });
  }

  private handleRequest(req: JsonRpcRequest): void {
    if (!APPROVAL_METHODS.has(req.method)) {
      this.onOutgoingMessage({
        id: req.id,
        error: { code: -32601, message: `Unsupported method: ${req.method}` },
      });
      return;
    }

    const tool = inferToolFromApprovalRequest(req.method, req.params);
    const publicRequestId = toPublicRequestId(req.id);
    const itemId = parseItemId(req.params);

    this.pendingByRequestId.set(publicRequestId, {
      publicRequestId,
      requestId: req.id,
      method: req.method,
      tool,
      itemId,
    });
    if (itemId) this.pendingByItemId.set(itemId, publicRequestId);

    this.onHookEvent({
      payload: {
        event: "PreToolUse",
        tool,
        input: req.params,
      },
      requestId: publicRequestId,
    });
  }

  private handleResponse(res: JsonRpcResponse): void {
    if (res.id === INIT_REQUEST_ID && !this.handshakeInitializedSent) {
      if (res.error) {
        this.onError(res.error);
        return;
      }
      this.handshakeInitializedSent = true;
      this.onHandshakeReady();
      this.onOutgoingMessage({ method: "initialized" });
      this.startAutoResumeIfConfigured();
      return;
    }
    if (res.id === AUTO_RESUME_LOADED_LIST_REQUEST_ID) {
      this.handleAutoResumeLoadedListResponse(res);
      return;
    }
    if (res.id === AUTO_RESUME_LIST_REQUEST_ID) {
      this.handleAutoResumeListResponse(res);
      return;
    }
    if (typeof res.id === "string" && res.id.startsWith(AUTO_RESUME_RESUME_REQUEST_PREFIX)) {
      if (res.error) {
        this.onError(res.error);
        return;
      }
      this.onDebugLog("[codex-app-server] auto-resume succeeded");
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "serverRequest/resolved") {
      const params = asRecord(notification.params);
      if (!params || !isRequestId(params.requestId)) return;
      const publicRequestId = toPublicRequestId(params.requestId);
      this.settlePending(publicRequestId);
      return;
    }

    if (notification.method === "item/completed") {
      const params = asRecord(notification.params);
      const item = asRecord(params?.item);
      const itemId = typeof item?.id === "string" ? item.id : null;
      if (!itemId) return;
      const pendingRequestId = this.pendingByItemId.get(itemId);
      if (pendingRequestId) this.settlePending(pendingRequestId);
      return;
    }

    if (notification.method === "turn/completed" || notification.method === "thread/closed") {
      this.onHookEvent({
        payload: { event: "Stop" },
        requestId: null,
      });
    }
  }

  private settlePending(publicRequestId: string): void {
    const pending = this.pendingByRequestId.get(publicRequestId);
    if (!pending) return;
    this.pendingByRequestId.delete(publicRequestId);
    if (pending.itemId) this.pendingByItemId.delete(pending.itemId);
    this.onHookEvent({
      payload: { event: "PostToolUse", tool: pending.tool },
      requestId: publicRequestId,
    });
  }

  private startAutoResumeIfConfigured(): void {
    if (!this.autoResumeCwd) return;
    this.onDebugLog(`[codex-app-server] auto-resume scanning threads for cwd=${this.autoResumeCwd}`);
    this.autoResumeLoadedThreadIds = null;
    this.onOutgoingMessage({
      id: AUTO_RESUME_LOADED_LIST_REQUEST_ID,
      method: "thread/loaded/list",
      params: { limit: 50 },
    });
  }

  private requestAutoResumeThreadList(): void {
    this.onOutgoingMessage({
      id: AUTO_RESUME_LIST_REQUEST_ID,
      method: "thread/list",
      params: { limit: 100, sortKey: "updated_at" },
    });
  }

  private handleAutoResumeLoadedListResponse(res: JsonRpcResponse): void {
    if (res.error) {
      this.onError(res.error);
      this.autoResumeLoadedThreadIds = null;
      this.requestAutoResumeThreadList();
      return;
    }
    const result = asRecord(res.result);
    const rawIds = Array.isArray(result?.data) ? result.data : [];
    const ids = rawIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    this.autoResumeLoadedThreadIds = new Set(ids);
    this.onDebugLog(`[codex-app-server] auto-resume loaded threads=${ids.length}`);
    this.requestAutoResumeThreadList();
  }

  private handleAutoResumeListResponse(res: JsonRpcResponse): void {
    if (res.error) {
      this.onError(res.error);
      return;
    }
    const result = asRecord(res.result);
    const rows = Array.isArray(result?.data) ? result.data : [];
    const threads = rows.map((value) => parseAutoResumeThread(value)).filter((value): value is AutoResumeThread => value !== null);
    if (threads.length === 0) {
      const fallbackLoaded = this.autoResumeLoadedThreadIds?.values().next().value ?? null;
      if (typeof fallbackLoaded === "string" && fallbackLoaded.trim().length > 0) {
        this.onDebugLog(`[codex-app-server] auto-resume selecting loaded thread ${fallbackLoaded}`);
        this.onOutgoingMessage({
          id: `${AUTO_RESUME_RESUME_REQUEST_PREFIX}${fallbackLoaded}`,
          method: "thread/resume",
          params: { threadId: fallbackLoaded },
        });
        return;
      }
      this.onDebugLog("[codex-app-server] auto-resume found no existing threads");
      return;
    }

    let candidatePool = threads;
    if (this.autoResumeLoadedThreadIds && this.autoResumeLoadedThreadIds.size > 0) {
      const loadedPool = threads.filter((entry) => this.autoResumeLoadedThreadIds?.has(entry.id));
      if (loadedPool.length > 0) {
        candidatePool = loadedPool;
      } else {
        const fallbackLoaded = this.autoResumeLoadedThreadIds.values().next().value ?? null;
        if (typeof fallbackLoaded === "string" && fallbackLoaded.trim().length > 0) {
          this.onDebugLog(`[codex-app-server] auto-resume selecting loaded thread ${fallbackLoaded}`);
          this.onOutgoingMessage({
            id: `${AUTO_RESUME_RESUME_REQUEST_PREFIX}${fallbackLoaded}`,
            method: "thread/resume",
            params: { threadId: fallbackLoaded },
          });
          return;
        }
        this.onDebugLog("[codex-app-server] auto-resume loaded list did not overlap thread/list results");
      }
    }

    const chosen = selectPreferredAutoResumeThread(candidatePool, this.autoResumeCwd);
    const threadId = chosen?.id ?? null;
    if (!threadId) {
      this.onDebugLog("[codex-app-server] auto-resume thread id missing");
      return;
    }

    this.onDebugLog(
      `[codex-app-server] auto-resume selecting thread ${threadId} (cwd=${chosen?.cwd ?? "unknown"} status=${chosen?.statusType ?? "unknown"})`,
    );
    this.onOutgoingMessage({
      id: `${AUTO_RESUME_RESUME_REQUEST_PREFIX}${threadId}`,
      method: "thread/resume",
      params: { threadId },
    });
  }
}

export class CodexAppServerProvider {
  readonly kind = "app-server";

  private readonly onError: (error: unknown) => void;
  private readonly onDebugLog: (message: string) => void;
  private readonly onLifecycle: (event: CodexAppServerLifecycleEvent) => void;
  private readonly command: string;
  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly session: CodexAppServerSession;

  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stopping = false;

  constructor(options: CodexAppServerProviderOptions) {
    this.onError = options.onError ?? ((error) => console.warn("[codex-app-server] provider error:", error));
    this.onDebugLog = options.onDebugLog ?? (() => undefined);
    this.onLifecycle = options.onLifecycle ?? (() => undefined);
    this.command = options.command ?? resolveDefaultCodexAppServerCommand();
    this.args = options.args ?? ["app-server", "--listen", "stdio://"];
    this.env = options.env ?? process.env;
    this.session = new CodexAppServerSession({
      onHookEvent: options.onHookEvent,
      onOutgoingMessage: (msg) => this.sendMessage(msg),
      onDebugLog: this.onDebugLog,
      onHandshakeReady: () => this.emitLifecycle({ state: "ready", at: Date.now() }),
      onError: this.onError,
      clientInfo: options.clientInfo,
      autoResumeCwd: options.autoResumeCwd,
    });
  }

  async start(): Promise<boolean> {
    if (this.process) return true;
    try {
      this.emitLifecycle({ state: "starting", at: Date.now() });
      this.stopping = false;
      const child = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: this.env,
      });
      this.process = child;
      this.stdoutBuffer = "";
      this.onDebugLog(`launching: ${this.command} ${this.args.join(" ")}`);
      this.emitLifecycle({ state: "spawned", at: Date.now(), detail: `${this.command} ${this.args.join(" ")}` });

      child.on("error", (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "ENOENT"
        ) {
          this.onError(
            new Error(
              `codex app-server command not found: '${this.command}' (looked for app bundle path and PATH binary)`,
            ),
          );
        }
        this.onError(error);
        this.emitLifecycle({ state: "error", at: Date.now(), detail: errorMessage });
      });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        this.ingestStdout(chunk);
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const text = chunk.trim();
        if (!text) return;
        this.onDebugLog(text);
      });

      child.on("exit", (code, signal) => {
        this.process = null;
        this.stdoutBuffer = "";
        this.session.stop();
        this.emitLifecycle({ state: "exit", at: Date.now(), code, signal });
        if (this.stopping) {
          this.stopping = false;
          return;
        }
        this.onError(new Error(`codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
      });

      this.session.startHandshake();
      this.emitLifecycle({ state: "handshake-sent", at: Date.now() });
      return true;
    } catch (error) {
      this.onError(error);
      this.emitLifecycle({
        state: "start-failed",
        at: Date.now(),
        detail: error instanceof Error ? error.message : String(error),
      });
      this.process = null;
      this.stdoutBuffer = "";
      this.session.stop();
      return false;
    }
  }

  stop(): void {
    this.stopping = true;
    this.session.stop();
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.stdoutBuffer = "";
    this.emitLifecycle({ state: "stopped", at: Date.now() });
  }

  async resolveApproval(requestId: string, decision: CodexApprovalDecision): Promise<void> {
    await this.session.resolveApproval(requestId, decision);
  }

  ingestMessageForTest(message: unknown): void {
    this.session.ingestMessage(message);
  }

  private ingestStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as unknown;
        this.session.ingestMessage(message);
      } catch (error) {
        this.onError(new Error(`[codex-app-server] failed to parse JSON-RPC line: ${line}`));
        this.onError(error);
      }
    }
  }

  private sendMessage(message: Record<string, unknown>): void {
    const payload = `${JSON.stringify(message)}\n`;
    if (!this.process || this.process.stdin.destroyed) return;
    this.process.stdin.write(payload);
  }

  private emitLifecycle(event: CodexAppServerLifecycleEvent): void {
    this.onLifecycle(event);
  }
}
