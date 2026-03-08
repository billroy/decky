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
