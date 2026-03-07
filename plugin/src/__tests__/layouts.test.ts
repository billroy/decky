import { describe, it, expect } from "vitest";
import { getSlotConfig, getLayout, getLayoutStates, type MacroInput } from "../layouts.js";

describe("layouts", () => {
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
      expect(config.action).toBeUndefined();
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
      expect(config.action).toBeUndefined();
    });

    it("caps macros at 6 slots", () => {
      const manyMacros: MacroInput[] = Array.from({ length: 10 }, (_, i) => ({
        label: `M${i}`, text: `text${i}`,
      }));
      const config = getSlotConfig("idle", 7, null, manyMacros);
      expect(config.title).toBe("");
    });

    it("truncates long macro labels in SVG", () => {
      const longMacros: MacroInput[] = [{ label: "VeryLongMacroLabel", text: "test" }];
      const config = getSlotConfig("idle", 0, null, longMacros);
      expect(config.svg).toContain("VeryLongM\u2026");
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
});
