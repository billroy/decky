/**
 * EncoderAction unit tests.
 *
 * Tests the feedback payload builder (buildFeedback) and helper functions
 * without requiring a real Stream Deck connection.
 */

import { describe, it, expect } from "vitest";
import { buildFeedback, stateLabel, buildThemeFeedback } from "../actions/encoder.js";
import { THEME_LIST } from "../layouts.js";
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

describe("buildFeedback — idle state", () => {
  it("shows Idle label and empty value", () => {
    const fb = buildFeedback(makeSnapshot(), 0);
    expect(fb.title).toBe("Idle");
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

describe("buildThemeFeedback", () => {
  it("shows theme name as title and 'Theme' as value", () => {
    const fb = buildThemeFeedback("dracula");
    expect(fb.title).toBe("dracula");
    expect(fb.value).toBe("Theme");
    expect(fb.indicator).toBe(0);
  });
});

describe("THEME_LIST — cycling arithmetic", () => {
  it("contains all 13 themes in order", () => {
    expect(THEME_LIST).toHaveLength(13);
    expect(THEME_LIST[0]).toBe("light");
    expect(THEME_LIST[THEME_LIST.length - 1]).toBe("random");
  });

  it("advances forward by ticks", () => {
    const idx = THEME_LIST.indexOf("dark"); // 1
    const next = (idx + 1) % THEME_LIST.length;
    expect(THEME_LIST[next]).toBe("dracula");
  });

  it("retreats backward by ticks", () => {
    const idx = THEME_LIST.indexOf("dark"); // 1
    const next = ((idx - 1) % THEME_LIST.length + THEME_LIST.length) % THEME_LIST.length;
    expect(THEME_LIST[next]).toBe("light");
  });

  it("wraps forward from last to first", () => {
    const idx = THEME_LIST.indexOf("random"); // 12
    const next = (idx + 1) % THEME_LIST.length;
    expect(THEME_LIST[next]).toBe("light");
  });

  it("wraps backward from first to last", () => {
    const idx = THEME_LIST.indexOf("light"); // 0
    const next = ((idx - 1) % THEME_LIST.length + THEME_LIST.length) % THEME_LIST.length;
    expect(THEME_LIST[next]).toBe("random");
  });

  it("handles multi-tick jumps", () => {
    const idx = THEME_LIST.indexOf("dark"); // 1
    const next = ((idx + 5) % THEME_LIST.length + THEME_LIST.length) % THEME_LIST.length;
    expect(THEME_LIST[next]).toBe("nord"); // index 6
  });

  it("handles multi-tick backward jumps", () => {
    const idx = THEME_LIST.indexOf("dark"); // 1
    const next = ((idx - 3) % THEME_LIST.length + THEME_LIST.length) % THEME_LIST.length;
    expect(THEME_LIST[next]).toBe("rainbow"); // index 11 (1 - 3 + 13 = 11)
  });
});
