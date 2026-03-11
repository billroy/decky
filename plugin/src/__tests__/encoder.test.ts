/**
 * EncoderAction unit tests.
 *
 * Tests the feedback payload builder (buildFeedback) and helper functions
 * without requiring a real Stream Deck connection.
 */

import { describe, it, expect } from "vitest";
import { buildFeedback, stateLabel, rateLimitColor } from "../actions/encoder.js";
import type { StateSnapshot } from "../bridge-client.js";

function makeSnapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    state: "idle",
    previousState: null,
    tool: null,
    lastEvent: null,
    timestamp: Date.now(),
    approval: null,
    question: null,
    rateLimit: null,
    ...overrides,
  };
}

describe("stateLabel", () => {
  it.each([
    ["idle", "Idle"],
    ["thinking", "Thinking…"],
    ["tool-executing", "Executing"],
    ["awaiting-approval", "Approve?"],
    ["asking", "Question"],
    ["done", "Done ✓"],
    ["stopped", "Stopped"],
  ])("maps state '%s' to label '%s'", (state, label) => {
    expect(stateLabel(makeSnapshot({ state }))).toBe(label);
  });

  it("returns the raw state string for unknown states", () => {
    expect(stateLabel(makeSnapshot({ state: "some-future-state" }))).toBe("some-future-state");
  });
});

describe("rateLimitColor", () => {
  it("returns green for < 60%", () => {
    expect(rateLimitColor(0)).toBe("#22c55e");
    expect(rateLimitColor(59)).toBe("#22c55e");
  });

  it("returns amber for 60–84%", () => {
    expect(rateLimitColor(60)).toBe("#f59e0b");
    expect(rateLimitColor(84)).toBe("#f59e0b");
  });

  it("returns red for >= 85%", () => {
    expect(rateLimitColor(85)).toBe("#ef4444");
    expect(rateLimitColor(100)).toBe("#ef4444");
  });
});

describe("buildFeedback — idle state", () => {
  it("shows Idle label and empty value when no rate limit data", () => {
    const fb = buildFeedback(makeSnapshot(), 0);
    expect(fb.title).toBe("Idle");
    expect(fb.value).toBe("");
    expect(fb.indicator).toBe(0);
  });

  it("shows rate limit % when percentUsed is available", () => {
    const snapshot = makeSnapshot({
      rateLimit: { totalTokens5h: 50000, percentUsed: 72, resetAt: null },
    });
    const fb = buildFeedback(snapshot, 0);
    expect(fb.title).toBe("Idle");
    expect(fb.value).toBe("72% used");
    expect(fb.indicator).toBe(72);
  });

  it("rounds fractional percentUsed", () => {
    const snapshot = makeSnapshot({
      rateLimit: { totalTokens5h: 50000, percentUsed: 72.6, resetAt: null },
    });
    const fb = buildFeedback(snapshot, 0);
    expect(fb.value).toBe("73% used");
    expect(fb.indicator).toBe(73);
  });

  it("shows empty value when percentUsed is null", () => {
    const snapshot = makeSnapshot({
      rateLimit: { totalTokens5h: 0, percentUsed: null, resetAt: null },
    });
    const fb = buildFeedback(snapshot, 0);
    expect(fb.value).toBe("");
    expect(fb.indicator).toBe(0);
  });
});

describe("buildFeedback — awaiting-approval state", () => {
  const approvalBase = {
    pending: 1,
    position: 1,
    targetApp: "claude" as const,
    flow: "mirror" as const,
    requestId: "req-1",
  };

  it("shows tool name and Approve? label", () => {
    const snapshot = makeSnapshot({
      state: "awaiting-approval",
      tool: "Bash",
      approval: { ...approvalBase },
    });
    const fb = buildFeedback(snapshot, 0);
    expect(fb.title).toBe("Approve?");
    expect(fb.value).toBe("Bash");
    expect(fb.indicator).toBe(50);
  });

  it("shows Tool when tool name is null", () => {
    const snapshot = makeSnapshot({
      state: "awaiting-approval",
      tool: null,
      approval: { ...approvalBase },
    });
    const fb = buildFeedback(snapshot, 0);
    expect(fb.value).toBe("Tool");
  });

  it("shows count suffix when pending > 1", () => {
    const snapshot = makeSnapshot({
      state: "awaiting-approval",
      tool: "Read",
      approval: { ...approvalBase, pending: 3 },
    });
    const fb = buildFeedback(snapshot, 0);
    expect(fb.value).toBe("Read (1/3)");
  });

  it("preview offset cycles within pending count", () => {
    const snapshot = makeSnapshot({
      state: "awaiting-approval",
      tool: "Write",
      approval: { ...approvalBase, pending: 3 },
    });
    expect(buildFeedback(snapshot, 1).value).toBe("Write (2/3)");
    expect(buildFeedback(snapshot, 2).value).toBe("Write (3/3)");
    // wraps
    expect(buildFeedback(snapshot, 3).value).toBe("Write (1/3)");
  });
});

describe("buildFeedback — other states", () => {
  it("thinking state shows Thinking… label", () => {
    const fb = buildFeedback(makeSnapshot({ state: "thinking" }), 0);
    expect(fb.title).toBe("Thinking…");
    expect(fb.value).toBe("");
  });

  it("done state shows Done ✓ label", () => {
    const fb = buildFeedback(makeSnapshot({ state: "done" }), 0);
    expect(fb.title).toBe("Done ✓");
  });
});
