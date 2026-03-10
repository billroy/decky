/**
 * Decky state machine — tracks Claude Code session state.
 *
 * States: idle, thinking, awaiting-approval, tool-executing, stopped
 * Transitions are driven by Claude Code lifecycle hook events.
 */

export type State =
  | "idle"
  | "thinking"
  | "awaiting-approval"
  | "tool-executing"
  | "stopped";

export type HookEvent =
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "Notification"
  | "Stop"
  | "SubagentStop";

export interface HookPayload {
  event: HookEvent;
  tool?: string;
  input?: unknown;
  [key: string]: unknown;
}

export interface StateSnapshot {
  state: State;
  previousState: State | null;
  tool: string | null;
  lastEvent: HookEvent | null;
  timestamp: number;
}

type StateChangeListener = (snapshot: StateSnapshot) => void;

export class StateMachine {
  private state: State = "idle";
  private previousState: State | null = null;
  private tool: string | null = null;
  private lastEvent: HookEvent | null = null;
  private timestamp: number = Date.now();
  private listeners: StateChangeListener[] = [];

  /** Transition table: maps (currentState, event) → nextState */
  private static transitions: Record<string, State | undefined> = {
    // PreToolUse → awaiting-approval (used by gate flow and codex source)
    // In mirror flow from hooks, PreToolUse is skipped — PermissionRequest
    // is used instead (see applyHookPayload in app.ts).
    "idle:PreToolUse": "awaiting-approval",
    "thinking:PreToolUse": "awaiting-approval",
    "tool-executing:PreToolUse": "awaiting-approval",
    "stopped:PreToolUse": "awaiting-approval",

    // PermissionRequest → awaiting-approval (only fires when Claude's
    // permission dialog is about to appear — not for auto-approved tools)
    "idle:PermissionRequest": "awaiting-approval",
    "thinking:PermissionRequest": "awaiting-approval",
    "tool-executing:PermissionRequest": "awaiting-approval",
    "stopped:PermissionRequest": "awaiting-approval",

    // PostToolUse → idle (tool finished; thinking state is disabled for now
    // because it interferes with deck usability — revisit when UI is reworked)
    "tool-executing:PostToolUse": "idle",
    // PostToolUse can arrive in awaiting-approval if approval was
    // handled outside decky (e.g. user clicked in Claude.app directly)
    "awaiting-approval:PostToolUse": "idle",
    // PostToolUse can arrive in idle/thinking when PreToolUse was skipped
    // (mirror flow auto-approved tools)
    "idle:PostToolUse": "idle",
    "thinking:PostToolUse": "idle",

    // Stop → idle (Claude finished responding)
    "thinking:Stop": "idle",
    "tool-executing:Stop": "idle",
    "awaiting-approval:Stop": "idle",
    "idle:Stop": "idle",

    // SubagentStop → idle
    "thinking:SubagentStop": "idle",
    "tool-executing:SubagentStop": "idle",
    "idle:SubagentStop": "idle",

    // Notification → no state change (handled specially below)
  };

  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getSnapshot(): StateSnapshot {
    return {
      state: this.state,
      previousState: this.previousState,
      tool: this.tool,
      lastEvent: this.lastEvent,
      timestamp: this.timestamp,
    };
  }

  /**
   * Process an incoming hook event and transition state.
   * Returns the new state snapshot.
   */
  processEvent(payload: HookPayload): StateSnapshot {
    const { event, tool } = payload;
    this.lastEvent = event;

    // Notification doesn't change state — just record and notify
    if (event === "Notification") {
      this.timestamp = Date.now();
      const snap = this.getSnapshot();
      this.notify(snap);
      return snap;
    }

    const key = `${this.state}:${event}`;
    const nextState = StateMachine.transitions[key];

    if (nextState && nextState !== this.state) {
      this.previousState = this.state;
      this.state = nextState;
      this.tool = tool ?? this.tool;
      this.timestamp = Date.now();

      const snap = this.getSnapshot();
      console.log(
        `[state] ${this.previousState} → ${this.state} (event=${event}${tool ? `, tool=${tool}` : ""})`
      );
      this.notify(snap);
      return snap;
    }

    // No transition found — log but don't crash
    if (!nextState) {
      console.log(
        `[state] no transition for ${this.state}:${event} — staying in ${this.state}`
      );
    }

    this.timestamp = Date.now();
    return this.getSnapshot();
  }

  /**
   * Force-set state (for approve/deny actions from StreamDeck).
   */
  forceState(newState: State, reason?: string, tool?: string | null): StateSnapshot {
    this.previousState = this.state;
    this.state = newState;
    if (tool !== undefined) this.tool = tool;
    this.timestamp = Date.now();

    const snap = this.getSnapshot();
    console.log(
      `[state] ${this.previousState} → ${this.state} (forced${reason ? `: ${reason}` : ""})`
    );
    this.notify(snap);
    return snap;
  }

  private notify(snapshot: StateSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
