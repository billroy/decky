import { describe, it, expect } from "vitest";
import { ApprovalTraceStore } from "../approval-trace.js";

describe("ApprovalTraceStore.getSessionStats", () => {
  it("returns zero counts when no traces exist", () => {
    const store = new ApprovalTraceStore();
    expect(store.getSessionStats()).toEqual({ approves: 0, denials: 0 });
  });

  it("counts approves and denials correctly", () => {
    const store = new ApprovalTraceStore();
    store.start({ actionId: "a1", action: "approve", targetApp: "claude" });
    store.start({ actionId: "a2", action: "deny", targetApp: "claude" });
    store.start({ actionId: "a3", action: "approve", targetApp: "claude" });
    store.start({ actionId: "a4", action: "cancel", targetApp: "claude" });
    store.start({ actionId: "a5", action: "deny", targetApp: "claude" });
    expect(store.getSessionStats()).toEqual({ approves: 2, denials: 2 });
  });

  it("ignores cancel actions", () => {
    const store = new ApprovalTraceStore();
    store.start({ actionId: "a1", action: "cancel", targetApp: "claude" });
    store.start({ actionId: "a2", action: "cancel", targetApp: null });
    expect(store.getSessionStats()).toEqual({ approves: 0, denials: 0 });
  });
});
