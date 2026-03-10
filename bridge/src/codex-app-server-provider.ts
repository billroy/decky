import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import type { HookPayload } from "./state-machine.js";

export type CodexApprovalDecision = "approve" | "deny" | "cancel";
export type JsonRpcRequestId = string | number;

const PUBLIC_REQUEST_PREFIX = "jsonrpc:";
const INIT_REQUEST_ID = "decky-init";

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

export interface CodexAppServerHookEvent {
  payload: HookPayload;
  requestId: string | null;
}

export interface CodexAppServerSessionOptions {
  onHookEvent: (event: CodexAppServerHookEvent) => void;
  onOutgoingMessage?: (message: Record<string, unknown>) => void;
  onError?: (error: unknown) => void;
  clientInfo?: {
    name: string;
    version: string;
  };
}

export interface CodexAppServerProviderOptions extends CodexAppServerSessionOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  onDebugLog?: (message: string) => void;
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
  private readonly onError: (error: unknown) => void;
  private readonly clientInfo: { name: string; version: string };

  private handshakeInitializedSent = false;
  private pendingByRequestId = new Map<string, PendingApproval>();
  private pendingByItemId = new Map<string, string>();

  constructor(options: CodexAppServerSessionOptions) {
    this.onHookEvent = options.onHookEvent;
    this.onOutgoingMessage = options.onOutgoingMessage ?? (() => undefined);
    this.onError = options.onError ?? ((error) => console.warn("[codex-app-server] session error:", error));
    this.clientInfo = options.clientInfo ?? { name: "decky-bridge", version: "0.1.0" };
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
    if (res.id !== INIT_REQUEST_ID || this.handshakeInitializedSent) return;
    if (res.error) {
      this.onError(res.error);
      return;
    }
    this.handshakeInitializedSent = true;
    this.onOutgoingMessage({ method: "initialized" });
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
}

export class CodexAppServerProvider {
  readonly kind = "app-server";

  private readonly onError: (error: unknown) => void;
  private readonly onDebugLog: (message: string) => void;
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
    this.command = options.command ?? resolveDefaultCodexAppServerCommand();
    this.args = options.args ?? ["app-server", "--listen", "stdio://"];
    this.env = options.env ?? process.env;
    this.session = new CodexAppServerSession({
      onHookEvent: options.onHookEvent,
      onOutgoingMessage: (msg) => this.sendMessage(msg),
      onError: this.onError,
      clientInfo: options.clientInfo,
    });
  }

  async start(): Promise<boolean> {
    if (this.process) return true;
    try {
      this.stopping = false;
      const child = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: this.env,
      });
      this.process = child;
      this.stdoutBuffer = "";
      this.onDebugLog(`launching: ${this.command} ${this.args.join(" ")}`);

      child.on("error", (error) => {
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
        if (this.stopping) {
          this.stopping = false;
          return;
        }
        this.onError(new Error(`codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
      });

      this.session.startHandshake();
      return true;
    } catch (error) {
      this.onError(error);
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
}
