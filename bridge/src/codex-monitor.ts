import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { HookPayload } from "./state-machine.js";

const execFileAsync = promisify(execFile);

const CODEX_APP_SERVER_TARGET = "codex_app_server::codex_message_processor";
const CODEX_TOOLCALL_TARGET = "codex_core::stream_events_utils";

export interface CodexLogRow {
  id: number;
  target: string;
  message: string;
}

export interface CodexMonitorOptions {
  dbPath?: string;
  pollMs?: number;
  onHookEvent: (payload: HookPayload) => void;
  onError?: (error: unknown) => void;
}

export function defaultCodexStateDbPath(): string {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  return join(codexHome, "state_5.sqlite");
}

export function parseCodexAppServerEvent(message: string): string | null {
  const m = /^app-server event:\s+(\S+)/.exec(message.trim());
  return m?.[1] ?? null;
}

export function inferToolLabelFromToolCallMessage(message: string): string | null {
  const m = /^ToolCall:\s+([a-zA-Z0-9_.-]+)/.exec(message.trim());
  if (!m) return null;
  const toolName = m[1];
  if (toolName === "exec_command") return "Command";
  if (toolName === "apply_patch") return "Write";
  return toolName.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export class CodexMonitor {
  private readonly dbPath: string;
  private readonly pollMs: number;
  private readonly onHookEvent: (payload: HookPayload) => void;
  private readonly onError: (error: unknown) => void;
  private timer: NodeJS.Timeout | null = null;
  private pollInFlight = false;
  private lastId = 0;
  private approvalPending = false;
  private lastTool = "Command";

  constructor(options: CodexMonitorOptions) {
    this.dbPath = options.dbPath ?? defaultCodexStateDbPath();
    this.pollMs = options.pollMs ?? 350;
    this.onHookEvent = options.onHookEvent;
    this.onError = options.onError ?? ((error) => console.warn("[codex-monitor] poll error:", error));
  }

  async start(): Promise<boolean> {
    if (!existsSync(this.dbPath)) return false;
    this.lastId = await this.readMaxId();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollMs);
    return true;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  ingestLogRow(row: CodexLogRow): void {
    if (row.target === CODEX_TOOLCALL_TARGET) {
      const inferred = inferToolLabelFromToolCallMessage(row.message);
      if (inferred) this.lastTool = inferred;
      return;
    }

    if (row.target !== CODEX_APP_SERVER_TARGET) return;
    const event = parseCodexAppServerEvent(row.message);
    if (!event) return;

    if (event.endsWith("_approval_request")) {
      if (!this.approvalPending) {
        this.approvalPending = true;
        this.onHookEvent({ event: "PreToolUse", tool: this.lastTool });
      }
      return;
    }

    if (event === "codex/event/exec_command_end") {
      if (this.approvalPending) {
        this.approvalPending = false;
        this.onHookEvent({ event: "PostToolUse", tool: this.lastTool });
      }
      return;
    }

    if (event === "codex/event/item_completed") {
      if (this.approvalPending) {
        // Fallback for non-exec approvals (e.g. apply_patch), and for
        // denied approvals where no exec_command_end is emitted.
        this.approvalPending = false;
        this.onHookEvent({ event: "PostToolUse", tool: this.lastTool });
      }
      return;
    }

    if (event === "codex/event/task_complete") {
      this.approvalPending = false;
      this.onHookEvent({ event: "Stop" });
    }
  }

  private async poll(): Promise<void> {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const rows = await this.readRowsSince(this.lastId);
      for (const row of rows) {
        this.lastId = row.id;
        this.ingestLogRow(row);
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async readMaxId(): Promise<number> {
    const sql = "SELECT COALESCE(MAX(id), 0) FROM logs;";
    const out = (await this.querySqlite(sql)).trim();
    const n = Number(out);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  private async readRowsSince(id: number): Promise<CodexLogRow[]> {
    const sql = [
      "SELECT",
      "  id,",
      "  target,",
      "  replace(replace(coalesce(message, ''), char(10), ' '), char(13), ' ')",
      "FROM logs",
      `WHERE id > ${Math.max(0, Math.floor(id))}`,
      `  AND target IN ('${CODEX_APP_SERVER_TARGET}', '${CODEX_TOOLCALL_TARGET}')`,
      "ORDER BY id ASC",
      "LIMIT 400;",
    ].join(" ");

    const out = await this.querySqlite(sql);
    const rows: CodexLogRow[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const rowId = Number(parts[0]);
      if (!Number.isFinite(rowId)) continue;
      rows.push({
        id: Math.floor(rowId),
        target: parts[1] || "",
        message: parts.slice(2).join("\t"),
      });
    }
    return rows;
  }

  private async querySqlite(sql: string): Promise<string> {
    const { stdout } = await execFileAsync("sqlite3", ["-tabs", this.dbPath, sql], {
      timeout: 1500,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  }
}
