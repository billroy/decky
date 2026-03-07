import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp, type DeckyApp } from "../app.js";

let decky: DeckyApp;
let baseUrl: string;

beforeEach(async () => {
  decky = createApp();
  await new Promise<void>((resolve) => {
    decky.httpServer.listen(0, () => resolve());
  });
  const addr = decky.httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://localhost:${port}`;
});

afterEach(async () => {
  decky.io.close();
  await new Promise<void>((resolve) => decky.httpServer.close(() => resolve()));
});

describe("config endpoints", () => {
  it("GET /config returns config with macros array", async () => {
    const res = await fetch(`${baseUrl}/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("macros");
    expect(Array.isArray(data.macros)).toBe(true);
    expect(data.macros.length).toBeGreaterThan(0);
    expect(data).toHaveProperty("approvalTimeout");
  });

  it("each macro has label and text fields", async () => {
    const res = await fetch(`${baseUrl}/config`);
    const data = await res.json();
    for (const macro of data.macros) {
      expect(macro).toHaveProperty("label");
      expect(macro).toHaveProperty("text");
      expect(typeof macro.label).toBe("string");
      expect(typeof macro.text).toBe("string");
    }
  });

  it("POST /config/reload returns updated config", async () => {
    const res = await fetch(`${baseUrl}/config/reload`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.config).toHaveProperty("macros");
  });
});
