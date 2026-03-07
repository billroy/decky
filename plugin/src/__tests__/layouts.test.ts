import { describe, it, expect, afterEach } from "vitest";
import { getSlotConfig, getLayout, getLayoutStates, setTheme, type MacroInput } from "../layouts.js";

describe("layouts", () => {
  afterEach(() => setTheme("light"));
  describe("getLayoutStates", () => {
    it("returns all five states", () => {
      const states = getLayoutStates();
      expect(states).toContain("idle");
      expect(states).toContain("thinking");
      expect(states).toContain("awaiting-approval");
      expect(states).toContain("tool-executing");
      expect(states).toContain("stopped");
    });
  });

  describe("getLayout", () => {
    it("returns a layout object for known states", () => {
      const layout = getLayout("idle");
      expect(layout).toBeDefined();
      expect(Object.keys(layout).length).toBeGreaterThan(0);
    });

    it("returns empty object for unknown state", () => {
      const layout = getLayout("nonexistent");
      expect(layout).toEqual({});
    });
  });

  describe("idle layout (default macros)", () => {
    it("has 6 default macro stubs at slots 0-5", () => {
      for (let i = 0; i < 6; i++) {
        const config = getSlotConfig("idle", i);
        expect(config.title).toBe(`Macro ${i + 1}`);
        expect(config.action).toBe("macro");
        expect(config.data).toEqual({ text: "" });
        expect(config.svg).toContain("svg");
      }
    });

    it("returns empty config for slots beyond 5", () => {
      const config = getSlotConfig("idle", 6);
      expect(config.title).toBe("");
      expect(config.action).toBe("openConfig");
    });
  });

  describe("idle layout (config-driven macros)", () => {
    const macros: MacroInput[] = [
      { label: "Continue", text: "Continue" },
      { label: "Yes", text: "Yes" },
      { label: "No", text: "No" },
    ];

    it("renders macros from config", () => {
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.title).toBe("Continue");
      expect(config.action).toBe("macro");
      expect(config.data).toEqual({ text: "Continue" });
    });

    it("renders all provided macros", () => {
      for (let i = 0; i < macros.length; i++) {
        const config = getSlotConfig("idle", i, null, macros);
        expect(config.title).toBe(macros[i].label);
        expect(config.data).toEqual({ text: macros[i].text });
      }
    });

    it("returns empty for slots beyond provided macros", () => {
      const config = getSlotConfig("idle", 3, null, macros);
      expect(config.title).toBe("");
      expect(config.action).toBe("openConfig");
    });

    it("caps macros at 36 slots", () => {
      const manyMacros: MacroInput[] = Array.from({ length: 40 }, (_, i) => ({
        label: `M${i}`, text: `text${i}`,
      }));
      const config = getSlotConfig("idle", 36, null, manyMacros);
      expect(config.title).toBe("");
    });

    it("truncates long macro labels in SVG", () => {
      const longMacros: MacroInput[] = [{ label: "VeryLongMacroLabel", text: "test" }];
      const config = getSlotConfig("idle", 0, null, longMacros);
      expect(config.svg).toContain("VeryLongM\u2026");
    });

    it("renders checkmark icon with white background and green checkmark", () => {
      const macros: MacroInput[] = [{ label: "Yes", text: "Yes", icon: "checkmark" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#ffffff"');
      expect(config.svg).toContain('fill="#22c55e"');
      expect(config.svg).toContain("\u2713");
    });

    it("renders stop icon with white background and red stop sign", () => {
      const macros: MacroInput[] = [{ label: "No", text: "No", icon: "stop" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#ffffff"');
      expect(config.svg).toContain('fill="#ef4444"');
      expect(config.svg).toContain("\u2B23");
    });

    it("renders default blue style when no icon specified", () => {
      const macros: MacroInput[] = [{ label: "Summarize", text: "Summarize" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#1e3a5f"');
      expect(config.svg).toContain("\u25B6");
    });
  });

  describe("awaiting-approval layout", () => {
    it("slot 0 is Approve", () => {
      const config = getSlotConfig("awaiting-approval", 0);
      expect(config.title).toBe("Approve");
      expect(config.action).toBe("approve");
    });

    it("slot 1 is Deny", () => {
      const config = getSlotConfig("awaiting-approval", 1);
      expect(config.title).toBe("Deny");
      expect(config.action).toBe("deny");
    });

    it("slot 2 is Cancel", () => {
      const config = getSlotConfig("awaiting-approval", 2);
      expect(config.title).toBe("Cancel");
      expect(config.action).toBe("cancel");
    });

    it("slot 3 shows tool name when available", () => {
      const config = getSlotConfig("awaiting-approval", 3, "Bash");
      expect(config.title).toBe("Bash");
      expect(config.svg).toContain("Bash");
    });

    it("slot 3 is empty when no tool name", () => {
      const config = getSlotConfig("awaiting-approval", 3);
      expect(config.title).toBe("");
    });
  });

  describe("thinking layout", () => {
    it("slot 0 is thinking indicator", () => {
      const config = getSlotConfig("thinking", 0);
      expect(config.title).toContain("Thinking");
      expect(config.action).toBeUndefined();
    });

    it("slot 1 is Stop", () => {
      const config = getSlotConfig("thinking", 1);
      expect(config.title).toBe("Stop");
      expect(config.action).toBe("cancel");
    });
  });

  describe("tool-executing layout", () => {
    it("slot 0 is Stop", () => {
      const config = getSlotConfig("tool-executing", 0);
      expect(config.title).toBe("Stop");
      expect(config.action).toBe("cancel");
    });

    it("slot 1 shows tool name when available", () => {
      const config = getSlotConfig("tool-executing", 1, "Write");
      expect(config.title).toBe("Write");
      expect(config.svg).toContain("Write");
    });

    it("slot 1 is empty when no tool name", () => {
      const config = getSlotConfig("tool-executing", 1);
      expect(config.title).toBe("");
    });

    it("truncates long tool names in SVG", () => {
      const config = getSlotConfig("tool-executing", 1, "VeryLongToolName");
      expect(config.svg).toContain("VeryLon\u2026");
    });
  });

  describe("stopped layout", () => {
    it("slot 0 is Restart", () => {
      const config = getSlotConfig("stopped", 0);
      expect(config.title).toBe("Restart");
      expect(config.action).toBe("restart");
    });

    it("other slots are empty", () => {
      const config = getSlotConfig("stopped", 1);
      expect(config.title).toBe("");
    });
  });

  describe("unknown state", () => {
    it("returns empty for all slots", () => {
      const config = getSlotConfig("bogus", 0);
      expect(config.title).toBe("");
    });
  });

  describe("dark theme", () => {
    it("renders checkmark macro with dark background", () => {
      setTheme("dark");
      const macros: MacroInput[] = [{ label: "Yes", text: "Yes", icon: "checkmark" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#0f172a"');
      expect(config.svg).toContain('fill="#22c55e"');
      expect(config.svg).toContain('fill="#e2e8f0"');
    });

    it("renders default macro with dark background", () => {
      setTheme("dark");
      const macros: MacroInput[] = [{ label: "Test", text: "test" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#0f172a"');
      expect(config.svg).toContain('fill="#94a3b8"');
    });

    it("renders empty slot with dark background", () => {
      setTheme("dark");
      const config = getSlotConfig("idle", 99);
      expect(config.svg).toContain('fill="#0f172a"');
    });
  });

  describe("empty slot action", () => {
    it("has openConfig action", () => {
      const config = getSlotConfig("idle", 99);
      expect(config.action).toBe("openConfig");
    });
  });
});
