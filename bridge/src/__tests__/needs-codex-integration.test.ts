import { describe, it, expect } from "vitest";
import { needsCodexIntegration } from "../app.js";
import type { DeckyConfig } from "../config.js";

function makeConfig(overrides: Partial<DeckyConfig> = {}): DeckyConfig {
  return {
    macros: [],
    approvalTimeout: 30,
    theme: "light",
    editor: "bbedit",
    defaultTargetApp: "claude",
    showTargetBadge: false,
    popUpApp: false,
    enableApproveOnce: true,
    enableDictation: true,
    ...overrides,
  };
}

describe("needsCodexIntegration (utility — provider always starts at runtime)", () => {
  it("returns false when no codex buttons and defaultTargetApp is claude", () => {
    const cfg = makeConfig({
      macros: [
        { label: "Continue", text: "Continue" },
        { label: "Yes", text: "Yes" },
      ],
    });
    expect(needsCodexIntegration(cfg)).toBe(false);
  });

  it("returns true when defaultTargetApp is codex", () => {
    const cfg = makeConfig({ defaultTargetApp: "codex" });
    expect(needsCodexIntegration(cfg)).toBe(true);
  });

  it("returns true when a macro has targetApp codex", () => {
    const cfg = makeConfig({
      macros: [
        { label: "Claude", text: "hello", targetApp: "claude" },
        { label: "Codex", text: "hello", targetApp: "codex" },
      ],
    });
    expect(needsCodexIntegration(cfg)).toBe(true);
  });

  it("returns false when macros target other apps but not codex", () => {
    const cfg = makeConfig({
      macros: [
        { label: "Claude", text: "hello", targetApp: "claude" },
        { label: "Cursor", text: "hello", targetApp: "cursor" },
      ],
    });
    expect(needsCodexIntegration(cfg)).toBe(false);
  });

  it("returns false with empty macros array", () => {
    const cfg = makeConfig({ macros: [] });
    expect(needsCodexIntegration(cfg)).toBe(false);
  });
});
