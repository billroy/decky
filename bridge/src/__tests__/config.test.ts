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

  it("GET /config/backups returns backup metadata", async () => {
    const res = await fetch(`${baseUrl}/config/backups`, { headers: { "x-decky-token": token } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.backups)).toBe(true);
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
        enableApproveOnce: false,
        enableDictation: false,
        macros: [{ label: "Ship", text: "Ship it", targetApp: "chatgpt" }],
      }),
    });
    const data = await res.json();
    expect(data.config.defaultTargetApp).toBe("codex");
    expect(data.config.showTargetBadge).toBe(true);
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
            widget: { kind: "bridge-status", refreshMode: "interval", intervalMinutes: 5 },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.macros[0].type).toBe("widget");
    expect(data.config.macros[0].widget.kind).toBe("bridge-status");
    expect(data.config.macros[0].widget.intervalMinutes).toBe(5);
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
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${baseUrl}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-decky-token": token },
        body: JSON.stringify({ macros: [{ label: `B${i}`, text: `t${i}` }] }),
      });
      expect(res.status).toBe(200);
    }
    const backupsRes = await fetch(`${baseUrl}/config/backups`, { headers: { "x-decky-token": token } });
    expect(backupsRes.status).toBe(200);
    const backupsData = await backupsRes.json();
    const indices = (backupsData.backups as Array<{ index: number }>).map((b) => b.index).sort((a, b) => a - b);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(9);
    expect(indices).not.toContain(10);
  });

  it("POST /config/restore restores a previous backup", async () => {
    const first = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ macros: [{ label: "Before", text: "before" }] }),
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ macros: [{ label: "After", text: "after" }] }),
    });
    expect(second.status).toBe(200);

    const restoreRes = await fetch(`${baseUrl}/config/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ index: 0 }),
    });
    expect(restoreRes.status).toBe(200);
    const restoreData = await restoreRes.json();
    expect(restoreData.config.macros[0].label).toBe("Before");
  });

  it("POST /config/restore validates index", async () => {
    const restoreRes = await fetch(`${baseUrl}/config/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ index: 999 }),
    });
    expect(restoreRes.status).toBe(400);
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

  it("rejects unsafe editor command values", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-decky-token": token },
      body: JSON.stringify({ editor: "bbedit; rm -rf /" }),
    });
    expect(res.status).toBe(400);
  });
});
