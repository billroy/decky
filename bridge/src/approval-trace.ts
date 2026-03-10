type ApprovalTraceStatus = "open" | "settling" | "settled" | "failed" | "timed-out";

interface ApprovalTraceEvent {
  ts: number;
  stage: string;
  message: string;
  data?: Record<string, unknown>;
}

interface ApprovalTraceRecord {
  actionId: string;
  action: string;
  targetApp: "claude" | "codex" | null;
  createdAt: number;
  updatedAt: number;
  status: ApprovalTraceStatus;
  finalState?: string;
  finalReason?: string;
  events: ApprovalTraceEvent[];
}

interface StartInput {
  actionId: string;
  action: string;
  targetApp: "claude" | "codex" | null;
}

interface SettleInput {
  actionId: string;
  status: Extract<ApprovalTraceStatus, "settled" | "failed" | "timed-out">;
  finalState?: string;
  finalReason?: string;
}

const DEFAULT_MAX_TRACES = 80;
const DEFAULT_MAX_EVENTS_PER_TRACE = 120;

export class ApprovalTraceStore {
  private readonly maxTraces: number;
  private readonly maxEventsPerTrace: number;
  private traces: ApprovalTraceRecord[] = [];

  constructor(maxTraces = DEFAULT_MAX_TRACES, maxEventsPerTrace = DEFAULT_MAX_EVENTS_PER_TRACE) {
    this.maxTraces = Math.max(10, Math.floor(maxTraces));
    this.maxEventsPerTrace = Math.max(20, Math.floor(maxEventsPerTrace));
  }

  start(input: StartInput): ApprovalTraceRecord {
    const existing = this.findMutable(input.actionId);
    if (existing) return existing;
    const now = Date.now();
    const trace: ApprovalTraceRecord = {
      actionId: input.actionId,
      action: input.action,
      targetApp: input.targetApp,
      createdAt: now,
      updatedAt: now,
      status: "open",
      events: [],
    };
    this.traces.push(trace);
    this.trim();
    return trace;
  }

  append(actionId: string, stage: string, message: string, data?: Record<string, unknown>): void {
    const trace = this.findMutable(actionId);
    if (!trace) return;
    trace.events.push({
      ts: Date.now(),
      stage,
      message,
      data,
    });
    if (trace.events.length > this.maxEventsPerTrace) {
      trace.events.splice(0, trace.events.length - this.maxEventsPerTrace);
    }
    trace.updatedAt = Date.now();
  }

  setStatus(actionId: string, status: ApprovalTraceStatus, message?: string, data?: Record<string, unknown>): void {
    const trace = this.findMutable(actionId);
    if (!trace) return;
    trace.status = status;
    trace.updatedAt = Date.now();
    if (message) {
      this.append(actionId, "status", message, data);
    }
  }

  settle(input: SettleInput): void {
    const trace = this.findMutable(input.actionId);
    if (!trace) return;
    trace.status = input.status;
    trace.finalState = input.finalState;
    trace.finalReason = input.finalReason;
    trace.updatedAt = Date.now();
  }

  list(limit = 25): ApprovalTraceRecord[] {
    const n = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 25;
    const start = Math.max(0, this.traces.length - n);
    return this.traces.slice(start).map((t) => this.cloneTrace(t));
  }

  private findMutable(actionId: string): ApprovalTraceRecord | undefined {
    return this.traces.find((t) => t.actionId === actionId);
  }

  private trim(): void {
    if (this.traces.length > this.maxTraces) {
      this.traces.splice(0, this.traces.length - this.maxTraces);
    }
  }

  private cloneTrace(trace: ApprovalTraceRecord): ApprovalTraceRecord {
    return {
      ...trace,
      events: trace.events.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
    };
  }
}
