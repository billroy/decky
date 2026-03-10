import { describe, it, expect, beforeEach, vi } from "vitest";
import { StateMachine } from "../state-machine.js";

describe("StateMachine", () => {
  let sm: StateMachine;

  beforeEach(() => {
    sm = new StateMachine();
  });

  describe("initial state", () => {
    it("starts in idle", () => {
      const snap = sm.getSnapshot();
      expect(snap.state).toBe("idle");
      expect(snap.previousState).toBeNull();
      expect(snap.tool).toBeNull();
      expect(snap.lastEvent).toBeNull();
    });
  });

  describe("valid transitions", () => {
    it("idle → awaiting-approval on PreToolUse", () => {
      const snap = sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      expect(snap.state).toBe("awaiting-approval");
      expect(snap.previousState).toBe("idle");
      expect(snap.tool).toBe("Bash");
    });

    it("awaiting-approval → thinking on PostToolUse (approved outside decky)", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      const snap = sm.processEvent({ event: "PostToolUse", tool: "Bash" });
      expect(snap.state).toBe("thinking");
      expect(snap.previousState).toBe("awaiting-approval");
    });

    it("tool-executing → thinking on PostToolUse", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      sm.forceState("tool-executing", "approved");
      const snap = sm.processEvent({ event: "PostToolUse", tool: "Bash" });
      expect(snap.state).toBe("thinking");
      expect(snap.previousState).toBe("tool-executing");
    });

    it("thinking → idle on Stop", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      sm.processEvent({ event: "PostToolUse", tool: "Bash" });
      // Now in thinking
      const snap = sm.processEvent({ event: "Stop" });
      expect(snap.state).toBe("idle");
      expect(snap.previousState).toBe("thinking");
    });

    it("idle → idle on Stop (no-op but valid)", () => {
      const snap = sm.processEvent({ event: "Stop" });
      expect(snap.state).toBe("idle");
    });

    it("awaiting-approval → idle on Stop (interrupt)", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      const snap = sm.processEvent({ event: "Stop" });
      expect(snap.state).toBe("idle");
      expect(snap.previousState).toBe("awaiting-approval");
    });

    it("idle → idle on SubagentStop", () => {
      const snap = sm.processEvent({ event: "SubagentStop" });
      expect(snap.state).toBe("idle");
    });

    it("thinking → idle on SubagentStop", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      sm.processEvent({ event: "PostToolUse", tool: "Bash" });
      const snap = sm.processEvent({ event: "SubagentStop" });
      expect(snap.state).toBe("idle");
      expect(snap.previousState).toBe("thinking");
    });
  });

  describe("full approval cycle", () => {
    it("idle → awaiting-approval → tool-executing → thinking → idle", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Read" });
      expect(sm.getSnapshot().state).toBe("awaiting-approval");

      sm.forceState("tool-executing", "approved");
      expect(sm.getSnapshot().state).toBe("tool-executing");

      sm.processEvent({ event: "PostToolUse", tool: "Read" });
      expect(sm.getSnapshot().state).toBe("thinking");

      sm.processEvent({ event: "Stop" });
      expect(sm.getSnapshot().state).toBe("idle");
    });
  });

  describe("Notification", () => {
    it("does not change state", () => {
      const snap = sm.processEvent({ event: "Notification" });
      expect(snap.state).toBe("idle");
      expect(snap.lastEvent).toBe("Notification");
    });

    it("does not change state from awaiting-approval", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      const snap = sm.processEvent({ event: "Notification" });
      expect(snap.state).toBe("awaiting-approval");
    });
  });

  describe("invalid/unexpected transitions", () => {
    it("PostToolUse while idle — transitions to thinking", () => {
      const snap = sm.processEvent({ event: "PostToolUse", tool: "Bash" });
      expect(snap.state).toBe("thinking");
    });

    it("stopped → awaiting-approval on PreToolUse", () => {
      sm.forceState("stopped");
      const snap = sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      expect(snap.state).toBe("awaiting-approval");
      expect(snap.previousState).toBe("stopped");
    });

    it("tool-executing → awaiting-approval on PreToolUse", () => {
      sm.forceState("tool-executing");
      const snap = sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      expect(snap.state).toBe("awaiting-approval");
      expect(snap.previousState).toBe("tool-executing");
    });
  });

  describe("forceState", () => {
    it("transitions to any target state", () => {
      const snap = sm.forceState("tool-executing", "approved via StreamDeck");
      expect(snap.state).toBe("tool-executing");
      expect(snap.previousState).toBe("idle");
    });

    it("approve: awaiting-approval → tool-executing", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      const snap = sm.forceState("tool-executing", "approved");
      expect(snap.state).toBe("tool-executing");
      expect(snap.previousState).toBe("awaiting-approval");
    });

    it("deny: awaiting-approval → thinking", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      const snap = sm.forceState("thinking", "denied");
      expect(snap.state).toBe("thinking");
      expect(snap.previousState).toBe("awaiting-approval");
    });

    it("cancel: any → stopped", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      const snap = sm.forceState("stopped", "cancelled");
      expect(snap.state).toBe("stopped");
      expect(snap.previousState).toBe("awaiting-approval");
    });
  });

  describe("listeners", () => {
    it("fires on state transition", () => {
      const listener = vi.fn();
      sm.onStateChange(listener);
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].state).toBe("awaiting-approval");
    });

    it("fires on forceState", () => {
      const listener = vi.fn();
      sm.onStateChange(listener);
      sm.forceState("stopped", "test");
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].state).toBe("stopped");
    });

    it("fires on Notification (even though state doesn't change)", () => {
      const listener = vi.fn();
      sm.onStateChange(listener);
      sm.processEvent({ event: "Notification" });
      expect(listener).toHaveBeenCalledOnce();
    });

    it("does not fire after unsubscribe", () => {
      const listener = vi.fn();
      const unsub = sm.onStateChange(listener);
      unsub();
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      expect(listener).not.toHaveBeenCalled();
    });

    it("supports multiple listeners", () => {
      const a = vi.fn();
      const b = vi.fn();
      sm.onStateChange(a);
      sm.onStateChange(b);
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      expect(a).toHaveBeenCalledOnce();
      expect(b).toHaveBeenCalledOnce();
    });
  });

  describe("tool tracking", () => {
    it("records the tool name from the event", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Write" });
      expect(sm.getSnapshot().tool).toBe("Write");
    });

    it("retains tool name across transitions", () => {
      sm.processEvent({ event: "PreToolUse", tool: "Edit" });
      sm.forceState("tool-executing", "approved");
      expect(sm.getSnapshot().tool).toBe("Edit");
    });
  });

  describe("timestamp", () => {
    it("updates on every event", () => {
      const before = sm.getSnapshot().timestamp;
      sm.processEvent({ event: "PreToolUse", tool: "Bash" });
      expect(sm.getSnapshot().timestamp).toBeGreaterThanOrEqual(before);
    });
  });
});
