/**
 * Decky state machine — tracks Claude Code session state.
 *
 * States: idle, thinking, awaiting-approval, tool-executing, stopped, done, asking
 * Transitions are driven by Claude Code lifecycle hook events.
 *
 * The `done` state is reached when Claude finishes a turn (Stop event from
 * thinking or tool-executing). It holds until the user explicitly acknowledges
 * (presses the Done key, which fires forceState("idle")) or a new prompt
 * arrives (PreToolUse/PermissionRequest transitions back to awaiting-approval).
 *
 * The `asking` state is reached when Claude sends an AskUserQuestion hook event.
 * It holds until the user selects an option (forceState("idle")) or Stop arrives.
 */

type State =
  | "idle"
  | "thinking"
  | "awaiting-approval"
  | "tool-executing"
  | "stopped"
  | "done"
  | "asking";

export type HookEvent =
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "Notification"
  | "Stop"
  | "SubagentStop"
  | "AskUserQuestion";

export interface QuestionOption {
  label: string;
  value?: string;
}

export interface HookPayload {
  event: HookEvent;
  tool?: string;
  input?: unknown;
  question?: string;
  options?: QuestionOption[];
  usage?: Record<string, unknown>;
}

interface StateSnapshot {
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
    // Concurrent sessions: 2nd+ PermissionRequest arrives while already awaiting.
    // Stay in awaiting-approval (queue is managed separately in app.ts).
    "awaiting-approval:PermissionRequest": "awaiting-approval",

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

    // Stop — successful turn completion → done (requires user acknowledgment)
    // Exception: awaiting-approval:Stop goes to idle (interrupted session,
    // nothing was accomplished that needs acknowledgment).
    "thinking:Stop": "done",
    "tool-executing:Stop": "done",
    "awaiting-approval:Stop": "idle",
    "idle:Stop": "idle",
    "done:Stop": "done",          // duplicate stop is a no-op

    // SubagentStop → done (same acknowledgment flow as Stop)
    "thinking:SubagentStop": "done",
    "tool-executing:SubagentStop": "done",
    "idle:SubagentStop": "idle",
    "done:SubagentStop": "done",  // duplicate is a no-op

    // done → re-engage when a new tool/approval arrives
    "done:PreToolUse": "awaiting-approval",
    "done:PermissionRequest": "awaiting-approval",
    "done:PostToolUse": "idle",   // defensive — shouldn't normally occur

    // AskUserQuestion → asking (Claude is waiting for user to select an option)
    "idle:AskUserQuestion": "asking",
    "thinking:AskUserQuestion": "asking",
    "tool-executing:AskUserQuestion": "asking",
    "done:AskUserQuestion": "asking",
    // asking:Stop/PostToolUse → idle (question was dismissed or session ended)
    "asking:Stop": "idle",
    "asking:PostToolUse": "idle",

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
