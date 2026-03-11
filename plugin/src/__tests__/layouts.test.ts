import { describe, it, expect, afterEach } from "vitest";
import {
  getSlotConfig,
  getLayout,
  getLayoutStates,
  getLucideIconNames,
  slideInFrame,
  slideOutFrame,
  blackSVG,
  setTheme,
  setThemeSeed,
  setDefaultColors,
  setTargetBadgeOptions,
  setWidgetRenderContext,
  type MacroInput,
} from "../layouts.js";

describe("layouts", () => {
  afterEach(() => {
    setTheme("light");
    setThemeSeed(0);
    setDefaultColors({});
    setTargetBadgeOptions({ showTargetBadge: false, defaultTargetApp: "claude" });
  });
  describe("getLayoutStates", () => {
    it("returns all six states including done", () => {
      const states = getLayoutStates();
      expect(states).toContain("idle");
      expect(states).toContain("thinking");
      expect(states).toContain("awaiting-approval");
      expect(states).toContain("tool-executing");
      expect(states).toContain("stopped");
      expect(states).toContain("done");
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
        expect(config.data).toEqual({ text: "", targetApp: "claude", submit: true });
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
      expect(config.data).toEqual({ text: "Continue", targetApp: "claude", submit: true });
    });

    it("renders all provided macros", () => {
      for (let i = 0; i < macros.length; i++) {
        const config = getSlotConfig("idle", i, null, macros);
        expect(config.title).toBe(macros[i].label);
        expect(config.data).toEqual({ text: macros[i].text, targetApp: "claude", submit: true });
      }
    });

    it("returns empty for slots beyond provided macros", () => {
      const config = getSlotConfig("idle", 3, null, macros);
      expect(config.title).toBe("");
      expect(config.action).toBeUndefined();
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

    it("normalizes legacy checkmark icon to SVG check", () => {
      const macros: MacroInput[] = [{ label: "Yes", text: "Yes", icon: "checkmark" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#ffffff"');
      expect(config.svg).toContain('stroke="#1e293b"');
      expect(config.svg).toContain("M20 6 9 17");
    });

    it("normalizes legacy stop icon to octagon stop-sign SVG", () => {
      const macros: MacroInput[] = [{ label: "No", text: "No", icon: "stop" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#ffffff"');
      expect(config.svg).toContain("m7.86 2");
    });

    it("renders thumbs-down icon", () => {
      const macros: MacroInput[] = [{ label: "Down", text: "d", icon: "thumbs-down" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain("M9 18.12");
      expect(config.svg).toContain("M17 14V2");
    });

    it("renders circle-help icon", () => {
      const macros: MacroInput[] = [{ label: "Help", text: "h", icon: "circle-help" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain("M9.09 9a3");
      expect(config.svg).toContain("M12 17h.01");
    });

    it("getLucideIconNames includes thumbs-down and circle-help", () => {
      const names = getLucideIconNames();
      expect(names).toContain("thumbs-down");
      expect(names).toContain("circle-help");
      expect(names).toContain("thumbs-up");
    });

    it("renders theme macro style when no icon specified", () => {
      const macros: MacroInput[] = [{ label: "Summarize", text: "Summarize" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#ffffff"');
      expect(config.svg).toContain("\u25B6");
    });

    it("uses per-macro targetApp in action payload", () => {
      const macros: MacroInput[] = [{ label: "Ship", text: "Ship it", targetApp: "codex" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.data).toEqual({ text: "Ship it", targetApp: "codex", submit: true });
    });

    it("uses submit=false in macro action payload when configured", () => {
      const macros: MacroInput[] = [{ label: "Slash", text: "/review", submit: false }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.data).toEqual({ text: "/review", targetApp: "claude", submit: false });
    });

    it("renders slot utility actions through the macro renderer", () => {
      const macros: MacroInput[] = [{ label: "Approve Once", text: "", type: "approveOnceInClaude", icon: "checkmark" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.action).toBe("approveOnceInClaude");
      expect(config.title).toBe("Approve Once");
      expect(config.svg).toContain("svg");
      expect(config.svg).toContain("Approve O");
    });

    it("supports all built-in utility action types", () => {
      const cases: Array<{ type: NonNullable<MacroInput["type"]>; expected: string }> = [
        { type: "approve", expected: "approve" },
        { type: "deny", expected: "deny" },
        { type: "cancel", expected: "cancel" },
        { type: "stop", expected: "cancel" },
        { type: "restart", expected: "restart" },
        { type: "approveOnceInClaude", expected: "approveOnceInClaude" },
        { type: "startDictationForClaude", expected: "startDictationForClaude" },
      ];
      for (const c of cases) {
        const macros: MacroInput[] = [{ label: c.type, text: "", type: c.type, icon: "checkmark" }];
        const cfg = getSlotConfig("idle", 0, null, macros);
        expect(cfg.action).toBe(c.expected);
      }
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

    it("slot 2 is Stop", () => {
      const config = getSlotConfig("awaiting-approval", 2);
      expect(config.title).toBe("Stop");
      expect(config.action).toBe("cancel");
    });

    it("approval slots use targetApp from approval metadata", () => {
      const approval = {
        pending: 1,
        position: 1,
        targetApp: "codex" as const,
        flow: "mirror" as const,
        requestId: "req-codex",
      };
      const approve = getSlotConfig("awaiting-approval", 0, null, undefined, approval);
      expect(approve.data?.targetApp).toBe("codex");
      const deny = getSlotConfig("awaiting-approval", 1, null, undefined, approval);
      expect(deny.data?.targetApp).toBe("codex");
      const stop = getSlotConfig("awaiting-approval", 2, null, undefined, approval);
      expect(stop.data?.targetApp).toBe("codex");
    });

    it("approval slots default targetApp to claude when no metadata", () => {
      const approve = getSlotConfig("awaiting-approval", 0);
      expect(approve.data?.targetApp).toBe("claude");
      const deny = getSlotConfig("awaiting-approval", 1);
      expect(deny.data?.targetApp).toBe("claude");
      const stop = getSlotConfig("awaiting-approval", 2);
      expect(stop.data?.targetApp).toBe("claude");
    });

    it("slot 3 shows tool name when available", () => {
      const config = getSlotConfig("awaiting-approval", 3, "Bash", undefined, {
        pending: 2,
        position: 1,
        targetApp: "codex",
        flow: "mirror",
        requestId: "req-1",
      });
      expect(config.title).toBe("Bash");
      expect(config.svg).toContain("Bash");
      expect(config.svg).toContain("1/2");
    });

    it("slot 3 shows approval info when no tool name", () => {
      const config = getSlotConfig("awaiting-approval", 3);
      expect(config.title).toBe("Tool Approval");
      expect(config.svg).toContain("Info");
    });

    describe("approvalInfoSVG project name from cwd", () => {
      it("shows 'Info' when pending=1 regardless of cwd", () => {
        const config = getSlotConfig("awaiting-approval", 3, "Bash", undefined, {
          pending: 1, position: 1, targetApp: "claude", flow: "mirror", requestId: "r1",
          cwd: "/repos/myproject",
        });
        expect(config.svg).toContain(">Info<");
      });

      it("shows cwd basename when pending>1 and cwd is provided", () => {
        const config = getSlotConfig("awaiting-approval", 3, "Bash", undefined, {
          pending: 2, position: 1, targetApp: "claude", flow: "mirror", requestId: "r1",
          cwd: "/repos/my-project",
        });
        expect(config.svg).toContain(">my-project<");
        expect(config.svg).not.toContain(">Info<");
      });

      it("shows 'Info' when pending>1 but cwd is null", () => {
        const config = getSlotConfig("awaiting-approval", 3, "Bash", undefined, {
          pending: 2, position: 1, targetApp: "claude", flow: "mirror", requestId: "r1",
          cwd: null,
        });
        expect(config.svg).toContain(">Info<");
      });
    });

    it("slots beyond approval buttons (4+) show macro content instead of empty", () => {
      const macros: MacroInput[] = [
        { label: "M0", text: "t0" },
        { label: "M1", text: "t1" },
        { label: "M2", text: "t2" },
        { label: "M3", text: "t3" },
        { label: "M4", text: "t4" },
        { label: "M5", text: "t5" },
      ];
      const slot4 = getSlotConfig("awaiting-approval", 4, null, macros);
      expect(slot4.title).toBe("M4");
      const slot5 = getSlotConfig("awaiting-approval", 5, null, macros);
      expect(slot5.title).toBe("M5");
    });

    describe("risk level colors", () => {
      const baseApproval = { pending: 1, position: 1, targetApp: "claude" as const, flow: "mirror" as const, requestId: "req-1" };

      it("defaults to green when riskLevel is null", () => {
        const config = getSlotConfig("awaiting-approval", 0, null, undefined, { ...baseApproval, riskLevel: null });
        expect(config.svg).toContain("#22c55e");
      });

      it("stays green when riskLevel is safe", () => {
        const config = getSlotConfig("awaiting-approval", 0, null, undefined, { ...baseApproval, riskLevel: "safe" });
        expect(config.svg).toContain("#22c55e");
      });

      it("turns amber when riskLevel is warning", () => {
        const config = getSlotConfig("awaiting-approval", 0, null, undefined, { ...baseApproval, riskLevel: "warning" });
        expect(config.svg).toContain("#f59e0b");
      });

      it("turns red when riskLevel is critical", () => {
        const config = getSlotConfig("awaiting-approval", 0, null, undefined, { ...baseApproval, riskLevel: "critical" });
        expect(config.svg).toContain("#ef4444");
      });
    });

    it("getLayout for awaiting-approval includes macro slots beyond 3", () => {
      const macros: MacroInput[] = [
        { label: "M0", text: "t0" },
        { label: "M1", text: "t1" },
        { label: "M2", text: "t2" },
        { label: "M3", text: "t3" },
        { label: "M4", text: "t4" },
      ];
      const layout = getLayout("awaiting-approval", macros);
      expect(layout[0]?.action).toBe("approve");
      expect(layout[1]?.action).toBe("deny");
      expect(layout[2]?.action).toBe("cancel");
      expect(layout[4]?.title).toBe("M4");
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

  describe("done layout", () => {
    it("slot 0 is Done acknowledge button (teal, restart action)", () => {
      const config = getSlotConfig("done", 0);
      expect(config.title).toBe("Done");
      expect(config.action).toBe("restart");
      expect(config.svg).toContain("#0d9488");
    });

    it("other slots are empty", () => {
      const config = getSlotConfig("done", 1);
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
    it("renders normalized checkmark macro with dark background", () => {
      setTheme("dark");
      const macros: MacroInput[] = [{ label: "Yes", text: "Yes", icon: "checkmark" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#0f172a"');
      expect(config.svg).toContain('stroke="#e2e8f0"');
      expect(config.svg).toContain('fill="#e2e8f0"');
    });

    it("renders default macro with dark background", () => {
      setTheme("dark");
      const macros: MacroInput[] = [{ label: "Test", text: "test" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#0f172a"');
      expect(config.svg).toContain('fill="#e2e8f0"');
    });

    it("renders empty slot with dark background", () => {
      setTheme("dark");
      const config = getSlotConfig("idle", 99);
      expect(config.svg).toContain('fill="#0f172a"');
    });
  });

  describe("light theme", () => {
    it("renders no-icon macro with light background", () => {
      setTheme("light");
      const macros: MacroInput[] = [{ label: "Summarize", text: "summarize" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#ffffff"');
      expect(config.svg).toContain('fill="#1e293b"');
    });

    it("renders empty slot with light background", () => {
      setTheme("light");
      const config = getSlotConfig("idle", 99);
      expect(config.svg).toContain('fill="#ffffff"');
      expect(config.svg).toContain('fill="#64748b"');
    });

    it("applies page default colors when macro has no overrides", () => {
      setTheme("light");
      setDefaultColors({ bg: "#ef4444", text: "#ffffff", icon: "#ffffff" });
      const macros: MacroInput[] = [{ label: "Summarize", text: "summarize" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#ef4444"');
      expect(config.svg).toContain('fill="#ffffff"');
    });

    it("applies macro overrides over page defaults", () => {
      setTheme("light");
      setDefaultColors({ bg: "#ef4444", text: "#ffffff", icon: "#ffffff" });
      const macros: MacroInput[] = [{
        label: "Summarize",
        text: "summarize",
        colors: { bg: "#22c55e", text: "#0f172a", icon: "#0f172a" },
      }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#22c55e"');
      expect(config.svg).toContain('fill="#0f172a"');
      expect(config.svg).not.toContain('fill="#ef4444"');
    });

    it("applies page default colors to empty slots", () => {
      setTheme("light");
      setDefaultColors({ bg: "#ef4444", text: "#ffffff", icon: "#ffffff" });
      const config = getSlotConfig("idle", 99);
      expect(config.svg).toContain('fill="#ef4444"');
      expect(config.svg).toContain('fill="#ffffff"');
    });

    it("treats empty label+text macro as unconfigured placeholder", () => {
      setTheme("light");
      const macros: MacroInput[] = [{ label: "", text: "" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.title).toBe("");
      expect(config.action).toBeUndefined();
      expect(config.svg).toContain("•••");
    });

    it("applies per-slot colors to unconfigured placeholder slots", () => {
      setTheme("light");
      setDefaultColors({ bg: "#ef4444", text: "#ffffff", icon: "#ffffff" });
      const macros: MacroInput[] = [{ label: "", text: "", colors: { bg: "#22c55e", text: "#052e16" } }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.title).toBe("");
      expect(config.action).toBeUndefined();
      expect(config.svg).toContain("•••");
      expect(config.svg).toContain('fill="#22c55e"');
      expect(config.svg).toContain('fill="#052e16"');
    });

    it("treats blank macro with stale target metadata as placeholder", () => {
      setTheme("light");
      const macros: MacroInput[] = [{ label: "", text: "", targetApp: "codex", submit: false }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.title).toBe("");
      expect(config.action).toBeUndefined();
      expect(config.svg).toContain("•••");
    });
  });

  describe("empty slot action", () => {
    it("is a no-op", () => {
      const config = getSlotConfig("idle", 99);
      expect(config.action).toBeUndefined();
    });
  });

  describe("target badge", () => {
    it("renders target badge text when enabled", () => {
      setTargetBadgeOptions({ showTargetBadge: true });
      const macros: MacroInput[] = [{ label: "Ship", text: "Ship", targetApp: "codex" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain("CDX");
      expect(config.svg).toContain('width="68"');
      expect(config.svg).toContain('font-size="13"');
    });

    it("hides badge when macro uses default provider", () => {
      setTargetBadgeOptions({ showTargetBadge: true });
      const implicitDefault: MacroInput[] = [{ label: "A", text: "a" }];
      const explicitDefault: MacroInput[] = [{ label: "B", text: "b", targetApp: "claude" }];
      expect(getSlotConfig("idle", 0, null, implicitDefault).svg).not.toContain("CLD");
      expect(getSlotConfig("idle", 0, null, explicitDefault).svg).not.toContain("CLD");
    });

    it("uses claude target app for action payload when macro target is unspecified", () => {
      setTargetBadgeOptions({ showTargetBadge: false, defaultTargetApp: "codex" });
      const macros: MacroInput[] = [{ label: "Ship", text: "ship it" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.data).toEqual({ text: "ship it", targetApp: "claude", submit: true });
    });

    it("hides badge when macro target matches configured defaultTargetApp", () => {
      setTargetBadgeOptions({ showTargetBadge: true, defaultTargetApp: "codex" });
      const macros: MacroInput[] = [{ label: "Ship", text: "ship it", targetApp: "codex" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).not.toContain("CDX");
    });

    it("shows badge when explicit target is non-claude", () => {
      setTargetBadgeOptions({ showTargetBadge: true, defaultTargetApp: "claude" });
      const macros: MacroInput[] = [{ label: "Ship", text: "ship it", targetApp: "codex" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain("CDX");
    });
  });

  describe("extended themes", () => {
    it("supports candy-cane theme with alternating stripe palettes", () => {
      setTheme("candy-cane");
      setThemeSeed(0);
      const macros: MacroInput[] = [
        { label: "One", text: "one" },
        { label: "Two", text: "two" },
      ];
      const slot0 = getSlotConfig("idle", 0, null, macros);
      const slot1 = getSlotConfig("idle", 1, null, macros);
      expect(slot0.svg).not.toEqual(slot1.svg);
      expect(slot0.svg + slot1.svg).toMatch(/fill="#(dc2626|f8fafc)"/);
    });

    it("supports gradient-blue theme with position-based color interpolation", () => {
      setTheme("gradient-blue");
      const macros: MacroInput[] = [
        { label: "One", text: "one" },
        { label: "Two", text: "two" },
      ];
      const slot0 = getSlotConfig("idle", 0, null, macros);
      const slot6 = getSlotConfig("idle", 6, null, macros);
      expect(slot0.svg).toMatch(/fill="#[0-9a-fA-F]{6}"/);
      expect(slot6.svg).toMatch(/fill="#[0-9a-fA-F]{6}"/);
      expect(slot0.svg).not.toEqual(slot6.svg);
    });

    it("supports wormhole theme with radial monochrome variation", () => {
      setTheme("wormhole");
      const macros: MacroInput[] = [
        { label: "One", text: "one" },
        { label: "Two", text: "two" },
      ];
      const edge = getSlotConfig("idle", 0, null, macros);
      const center = getSlotConfig("idle", 7, null, macros);
      expect(edge.svg).toMatch(/fill="#[0-9a-fA-F]{6}"/);
      expect(center.svg).toMatch(/fill="#[0-9a-fA-F]{6}"/);
      expect(edge.svg).not.toEqual(center.svg);
    });

    it("supports rainbow theme with per-slot variation", () => {
      setTheme("rainbow");
      setThemeSeed(1);
      const macros: MacroInput[] = [
        { label: "One", text: "one" },
        { label: "Two", text: "two" },
      ];
      const slot0 = getSlotConfig("idle", 0, null, macros);
      const slot1 = getSlotConfig("idle", 1, null, macros);
      const rainbowColors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6"];
      expect(rainbowColors.some((c) => slot0.svg.includes(`fill="${c}"`))).toBe(true);
      expect(rainbowColors.some((c) => slot1.svg.includes(`fill="${c}"`))).toBe(true);
      expect(slot0.svg).not.toEqual(slot1.svg);
    });

    it("supports random theme with deterministic per-slot colors", () => {
      setTheme("random");
      setThemeSeed(1);
      const macros: MacroInput[] = [
        { label: "One", text: "one" },
        { label: "Two", text: "two" },
      ];
      const a0 = getSlotConfig("idle", 0, null, macros);
      const a0b = getSlotConfig("idle", 0, null, macros);
      const a1 = getSlotConfig("idle", 1, null, macros);
      expect(a0.svg).toEqual(a0b.svg);
      expect(a0.svg).not.toEqual(a1.svg);
      expect(a0.svg).toMatch(/fill="#[0-9a-fA-F]{6}"/);
    });

    it("applies page default overrides in random theme", () => {
      setTheme("random");
      setThemeSeed(11);
      setDefaultColors({ bg: "#ef4444", text: "#ffffff", icon: "#ffffff" });
      const macros: MacroInput[] = [{ label: "One", text: "one" }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#ef4444"');
      expect(config.svg).toContain('fill="#ffffff"');
    });

    it("applies macro overrides in rainbow theme", () => {
      setTheme("rainbow");
      setThemeSeed(3);
      setDefaultColors({ bg: "#22c55e", text: "#111827", icon: "#111827" });
      const macros: MacroInput[] = [{
        label: "One",
        text: "one",
        colors: { bg: "#0f172a", text: "#f8fafc", icon: "#f8fafc" },
      }];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.svg).toContain('fill="#0f172a"');
      expect(config.svg).toContain('fill="#f8fafc"');
      expect(config.svg).not.toContain('fill="#22c55e"');
    });

    it("keeps random text/icon colors high contrast against background", () => {
      setTheme("random");
      setThemeSeed(7);
      const macros: MacroInput[] = [{ label: "One", text: "one" }];
      const svg = getSlotConfig("idle", 0, null, macros).svg;
      const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
      expect(fills.length).toBeGreaterThanOrEqual(3);
      const [bg, icon, text] = fills;
      expect(bg).not.toBe(icon);
      expect(bg).not.toBe(text);
    });

    it("changes rainbow distribution when theme seed changes", () => {
      const macros: MacroInput[] = [
        { label: "One", text: "one" },
        { label: "Two", text: "two" },
        { label: "Three", text: "three" },
      ];
      setTheme("rainbow");
      setThemeSeed(1);
      const a = getSlotConfig("idle", 0, null, macros).svg;
      setThemeSeed(2);
      const b = getSlotConfig("idle", 0, null, macros).svg;
      expect(a).not.toEqual(b);
    });
  });

  describe("widget macros", () => {
    it("renders bridge-status widget with refresh action", () => {
      setTheme("dark");
      setWidgetRenderContext({
        connectionStatus: "connected",
        state: "idle",
        timestamp: Date.now() - 10_000,
      });
      const macros: MacroInput[] = [
        {
          label: "Status",
          text: "",
          type: "widget",
          widget: { kind: "bridge-status", refreshMode: "onClick" },
        },
      ];
      const config = getSlotConfig("idle", 0, null, macros);
      expect(config.action).toBe("widget-refresh");
      expect(config.svg).toContain("Bridge:OK");
      expect(config.svg).toContain("State:idle");
    });
  });

  describe("animation frame helpers", () => {
    it("slideInFrame wraps content with translate and overflow hidden", () => {
      const svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
        <rect width="144" height="144" fill="#22c55e"/>
      </svg>`;
      const frame = slideInFrame(svg, 72);
      expect(frame).toContain('overflow="hidden"');
      expect(frame).toContain('translate(72, 0)');
      expect(frame).toContain('fill="#22c55e"');
      expect(frame).toContain('fill="#000000"');
    });

    it("slideInFrame at offset 0 has translate(0, 0)", () => {
      const svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
      const frame = slideInFrame(svg, 0);
      expect(frame).toContain("translate(0, 0)");
    });

    it("slideInFrame at offset 144 has translate(144, 0)", () => {
      const svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
      const frame = slideInFrame(svg, 144);
      expect(frame).toContain("translate(144, 0)");
    });

    it("slideInFrame preserves inner SVG content", () => {
      const svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
        <circle cx="72" cy="72" r="50" fill="red"/>
        <text x="72" y="72">Hello</text>
      </svg>`;
      const frame = slideInFrame(svg, 50);
      expect(frame).toContain('<circle cx="72" cy="72" r="50" fill="red"/>');
      expect(frame).toContain("Hello");
    });

    it("blackSVG produces a 144x144 black SVG", () => {
      const svg = blackSVG();
      expect(svg).toContain('width="144"');
      expect(svg).toContain('height="144"');
      expect(svg).toContain('fill="#000000"');
      // Should not contain any visible content (no text, no icons)
      expect(svg).not.toContain("<text");
      expect(svg).not.toContain("<circle");
      expect(svg).not.toContain("<g ");
    });

    it("slideOutFrame uses vertical translate with overflow hidden", () => {
      const svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
        <rect width="144" height="144" fill="#22c55e"/>
      </svg>`;
      const frame = slideOutFrame(svg, -72);
      expect(frame).toContain('overflow="hidden"');
      expect(frame).toContain("translate(0, -72)");
      expect(frame).toContain('fill="#000000"');
      expect(frame).toContain('fill="#22c55e"');
    });

    it("slideOutFrame at offset 0 has translate(0, 0)", () => {
      const svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
      const frame = slideOutFrame(svg, 0);
      expect(frame).toContain("translate(0, 0)");
    });

    it("slideOutFrame at offset -144 has translate(0, -144)", () => {
      const svg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg"><rect/></svg>`;
      const frame = slideOutFrame(svg, -144);
      expect(frame).toContain("translate(0, -144)");
    });
  });
});
