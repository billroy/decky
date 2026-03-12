// Allow config writes in tests by default; read-only tests manage this explicitly.
process.env.DECKY_READONLY = "0";

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createApp, type DeckyApp } from "../app.js";
import { CONFIG_PATH_VALUE } from "../config.js";
import { getBridgeToken } from "../security.js";

let decky: DeckyApp;
let baseUrl: string;
let savedConfig: string | null = null;
const token = getBridgeToken();

beforeAll(() => {
  savedConfig = existsSync(CONFIG_PATH_VALUE)
    ? readFileSync(CONFIG_PATH_VALUE, "utf-8")
    : null;
});

afterAll(() => {
  if (savedConfig !== null) {
    writeFileSync(CONFIG_PATH_VALUE, savedConfig, "utf-8");
  }
});

beforeEach(async () => {
  decky = createApp();
  await new Promise<void>((resolve) => {
    decky.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = decky.httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  decky.io.close();
  await new Promise<void>((resolve) => decky.httpServer.close(() => resolve()));
});

describe("config endpoints", () => {
  it("GET /config returns config with macros array", async () => {
    const res = await fetch(`${baseUrl}/config`, { headers: { "x-decky-token": token } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("macros");
    expect(Array.isArray(data.macros)).toBe(true);
    expect(data.macros.length).toBeGreaterThan(0);
    expect(data).toHaveProperty("approvalTimeout");
    expect(data).toHaveProperty("defaultTargetApp");
    expect(data).toHaveProperty("showTargetBadge");
    expect(data).toHaveProperty("popUpApp");
  });

  it("each macro has label and text fields", async () => {
    const res = await fetch(`${baseUrl}/config`, { headers: { "x-decky-token": token } });
    const data = await res.json();
    for (const macro of data.macros) {
      expect(macro).toHaveProperty("label");
      expect(macro).toHaveProperty("text");
      expect(typeof macro.label).toBe("string");
      expect(typeof macro.text).toBe("string");
    }
  });

  it("POST /config/reload returns updated config", async () => {
    const res = await fetch(`${baseUrl}/config/reload`, {
      method: "POST",
      headers: { "x-decky-token": token },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.config).toHaveProperty("macros");
  });


  it("PUT /config saves updated macros", async () => {
    const newMacros = [
      { label: "Test", text: "test text" },
      { label: "Other", text: "other text" },
    ];

    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ macros: newMacros }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.config.macros).toHaveLength(2);
    expect(data.config.macros[0].label).toBe("Test");
    expect(data.config.macros[1].text).toBe("other text");
  });

  it("PUT /config preserves approvalTimeout when not provided", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ macros: [{ label: "A", text: "B" }] }),
    });

    const data = await res.json();
    expect(data.config.approvalTimeout).toBe(30);
  });

  it("PUT /config saves multi-provider settings", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        defaultTargetApp: "codex",
        showTargetBadge: true,
        popUpApp: true,
        enableApproveOnce: false,
        enableDictation: false,
        macros: [{ label: "Ship", text: "Ship it", targetApp: "chatgpt" }],
      }),
    });
    const data = await res.json();
    expect(data.config.defaultTargetApp).toBe("codex");
    expect(data.config.showTargetBadge).toBe(true);
    expect(data.config.popUpApp).toBe(true);
    expect(data.config.enableApproveOnce).toBe(false);
    expect(data.config.enableDictation).toBe(false);
    expect(data.config.macros[0].targetApp).toBe("chatgpt");
  });

  it("PUT /config saves extended theme values", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ theme: "rainbow", themeSeed: 12345 }),
    });
    const data = await res.json();
    expect(data.config.theme).toBe("rainbow");
    expect(data.config.themeSeed).toBe(12345);
  });

  it("PUT /config accepts new theme values", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ theme: "gradient-blue" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.theme).toBe("gradient-blue");
  });

  it("PUT /config persists widget macros", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        macros: [
          {
            label: "Bridge",
            text: "",
            type: "widget",
            widget: { kind: "bridge-status" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros[0].type).toBe("widget");
    expect(data.config.macros[0].widget.kind).toBe("bridge-status");
  });

  it("PUT /config persists slot utility macro types", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        macros: [
          {
            label: "Approve Once",
            text: "",
            type: "approveOnceInClaude",
            icon: "checkmark",
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros[0].type).toBe("approveOnceInClaude");
    expect(data.config.macros[0].label).toBe("Approve Once");
  });

  it("PUT /config persists macro submit flag", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        macros: [{ label: "Slash", text: "/review", submit: false }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros[0].submit).toBe(false);
  });

  it("PUT /config persists macro font size", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        macros: [{ label: "Big", text: "big", fontSize: 34 }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros[0].fontSize).toBe(34);
  });

  it("PUT /config normalizes legacy icon aliases", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        macros: [{ label: "Stop", text: "stop", icon: "stop" }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros[0].icon).toBe("octagon-x");
  });

  it("PUT /config persists page defaults and per-macro colors", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        colors: { bg: "#ef4444", text: "#ffffff", icon: "#ffffff" },
        macros: [
          {
            label: "One",
            text: "one",
            colors: { bg: "#22c55e", text: "#0f172a", icon: "#0f172a" },
          },
          { label: "Two", text: "two" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.colors).toEqual({ bg: "#ef4444", text: "#ffffff", icon: "#ffffff" });
    expect(data.config.macros[0].colors).toEqual({ bg: "#22c55e", text: "#0f172a", icon: "#0f172a" });
    expect(data.config.macros[1].colors).toBeUndefined();
  });

  it("PUT /config preserves sparse placeholder slots for unconfigured keys", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        macros: [
          { label: "One", text: "one" },
          { label: "", text: "" },
          { label: "Three", text: "three" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros).toHaveLength(3);
    expect(data.config.macros[0]).toMatchObject({ label: "One", text: "one" });
    expect(data.config.macros[1]).toMatchObject({ label: "", text: "" });
    expect(data.config.macros[2]).toMatchObject({ label: "Three", text: "three" });
  });

  it("PUT /config allows color overrides on sparse placeholder slots", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        macros: [
          { label: "One", text: "one" },
          { label: "", text: "", colors: { bg: "#22c55e", text: "#052e16", icon: "#052e16" } },
          { label: "Three", text: "three" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros).toHaveLength(3);
    expect(data.config.macros[1]).toMatchObject({
      label: "",
      text: "",
      colors: { bg: "#22c55e", text: "#052e16", icon: "#052e16" },
    });
  });

  it("PUT /config canonicalizes stale placeholder metadata instead of rejecting color-only updates", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({
        macros: [
          { label: "One", text: "one" },
          {
            label: "",
            text: "",
            icon: "",
            targetApp: "codex",
            submit: false,
            colors: { bg: "#22c55e", text: "#052e16", icon: "#052e16" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros).toHaveLength(2);
    expect(data.config.macros[1]).toEqual({
      label: "",
      text: "",
      colors: { bg: "#22c55e", text: "#052e16", icon: "#052e16" },
    });
  });

  it("PUT /config clears page defaults when colors is empty object", async () => {
    await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ colors: { bg: "#ef4444", text: "#ffffff", icon: "#ffffff" } }),
    });
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ colors: {} }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.colors).toBeUndefined();
  });

  it("GET /config reflects saved changes", async () => {
    await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ macros: [{ label: "Saved", text: "saved text" }] }),
    });

    const res = await fetch(`${baseUrl}/config`, { headers: { "x-decky-token": token } });
    const data = await res.json();
    expect(data.macros[0].label).toBe("Saved");
  });

  it("rotates config backups in 0..9 range", async () => {
    const { dirname } = await import("node:path");
    const configDir = dirname(CONFIG_PATH_VALUE);
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ macros: [{ label: `B${i}`, text: `t${i}` }] }),
      });
      expect(res.status).toBe(200);
    }
    const { join } = await import("node:path");
    const presentIndices: number[] = [];
    for (let i = 0; i < 11; i++) {
      if (existsSync(join(configDir, `config.json.bak.${i}`))) {
        presentIndices.push(i);
      }
    }
    expect(presentIndices[0]).toBe(0);
    expect(presentIndices[presentIndices.length - 1]).toBe(9);
    expect(presentIndices).not.toContain(10);
  });

  it("rejects oversized macro arrays", async () => {
    const macros = Array.from({ length: 37 }, (_v, i) => ({ label: `M${i}`, text: "x" }));
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ macros }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid timeout values", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ approvalTimeout: 0 }),
    });
    expect(res.status).toBe(400);
  });

  describe("toolRiskRules", () => {
    it("saves valid toolRiskRules", async () => {
      const rules = [
        { pattern: "Bash", risk: "warning" },
        { pattern: "WriteFile", risk: "critical" },
        { pattern: "Read", risk: "safe" },
      ];
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ toolRiskRules: rules }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.config.toolRiskRules).toHaveLength(3);
      expect(data.config.toolRiskRules[0]).toEqual({ pattern: "Bash", risk: "warning" });
      expect(data.config.toolRiskRules[1]).toEqual({ pattern: "WriteFile", risk: "critical" });
      expect(data.config.toolRiskRules[2]).toEqual({ pattern: "Read", risk: "safe" });
    });

    it("rejects toolRiskRules that is not an array", async () => {
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ toolRiskRules: "Bash:warning" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects oversized toolRiskRules array (>100)", async () => {
      const rules = Array.from({ length: 101 }, (_, i) => ({ pattern: `Tool${i}`, risk: "safe" }));
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ toolRiskRules: rules }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects rule with empty pattern", async () => {
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ toolRiskRules: [{ pattern: "   ", risk: "safe" }] }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects rule with pattern exceeding 64 chars", async () => {
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ toolRiskRules: [{ pattern: "x".repeat(65), risk: "safe" }] }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects rule with invalid risk level", async () => {
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ toolRiskRules: [{ pattern: "Bash", risk: "dangerous" }] }),
      });
      expect(res.status).toBe(400);
    });

    it("defaults to empty toolRiskRules array in GET /config", async () => {
      const res = await fetch(`${baseUrl}/config`, {
        headers: { "x-decky-token": token },
      });
      const data = await res.json();
      expect(Array.isArray(data.toolRiskRules)).toBe(true);
    });
  });

  describe("read-only mode", () => {
    it("rejects PUT /config with 403 when readOnly is true (default)", async () => {
      // Remove the test-wide DECKY_READONLY=0 override to test real default behavior
      delete process.env.DECKY_READONLY;
      try {
        const res = await fetch(`${baseUrl}/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-decky-token": token },
          body: JSON.stringify({ macros: [{ label: "Test", text: "test" }] }),
        });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toContain("read-only");
      } finally {
        process.env.DECKY_READONLY = "0";
      }
    });

    it("allows PUT /config when DECKY_READONLY=0", async () => {
      // DECKY_READONLY=0 is already set at file level
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ macros: [{ label: "Test", text: "test" }] }),
      });
      expect(res.status).toBe(200);
    });

    it("allows PUT /config when readOnly is false in config", async () => {
      // First write readOnly: false into the config (DECKY_READONLY=0 is set)
      const setRes = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ readOnly: false }),
      });
      expect(setRes.status).toBe(200);

      // Now remove env override — readOnly: false in config should still allow writes
      delete process.env.DECKY_READONLY;
      try {
        const res = await fetch(`${baseUrl}/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-decky-token": token },
          body: JSON.stringify({ macros: [{ label: "Test2", text: "test2" }] }),
        });
        expect(res.status).toBe(200);
      } finally {
        process.env.DECKY_READONLY = "0";
      }
    });

    it("always allows POST /hook regardless of read-only state", async () => {
      // Default is readOnly: true, but hooks must still work
      const res = await fetch(`${baseUrl}/hook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ event: "PostToolUse", tool_name: "Bash" }),
      });
      expect(res.status).toBe(200);
    });

    it("always allows POST /config/reload regardless of read-only state", async () => {
      const res = await fetch(`${baseUrl}/config/reload`, {
        method: "POST",
        headers: { "x-decky-token": token },
      });
      expect(res.status).toBe(200);
    });

    it("always allows GET /config regardless of read-only state", async () => {
      const res = await fetch(`${baseUrl}/config`, {
        headers: { "x-decky-token": token },
      });
      expect(res.status).toBe(200);
    });
  });

});

