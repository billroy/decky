import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp, type DeckyApp } from "../app.js";

let decky: DeckyApp;
let baseUrl: string;

beforeAll(async () => {
  decky = createApp();
  await new Promise<void>((resolve) => {
    decky.httpServer.listen(0, () => resolve()); // random port
  });
  const addr = decky.httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  decky.io.close();
  await new Promise<void>((resolve) => decky.httpServer.close(() => resolve()));
});

async function postHook(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function getStatus() {
  const res = await fetch(`${baseUrl}/status`);
  return { status: res.status, data: await res.json() };
}

describe("GET /status", () => {
  it("returns idle state initially", async () => {
    const { status, data } = await getStatus();
    expect(status).toBe(200);
    expect(data.state).toBe("idle");
    expect(data).toHaveProperty("timestamp");
  });
});

describe("POST /hook", () => {
  it("accepts PreToolUse and transitions to awaiting-approval", async () => {
    const { status, data } = await postHook({ event: "PreToolUse", tool: "Bash" });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.state.state).toBe("awaiting-approval");
    expect(data.state.tool).toBe("Bash");
  });

  it("state persists — status reflects awaiting-approval", async () => {
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
  });

  it("accepts PostToolUse and transitions to thinking", async () => {
    const { data } = await postHook({ event: "PostToolUse", tool: "Bash" });
    expect(data.state.state).toBe("thinking");
  });

  it("accepts Stop and transitions to idle", async () => {
    const { data } = await postHook({ event: "Stop" });
    expect(data.state.state).toBe("idle");
  });

  it("accepts Notification without changing state", async () => {
    const { data } = await postHook({ event: "Notification" });
    expect(data.state.state).toBe("idle");
    expect(data.state.lastEvent).toBe("Notification");
  });

  it("rejects missing event with 400", async () => {
    const { status, data } = await postHook({});
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it("rejects invalid event with 400", async () => {
    const { status, data } = await postHook({ event: "Bogus" });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
    expect(data.validEvents).toContain("PreToolUse");
  });

  it("handles missing tool gracefully", async () => {
    const { status, data } = await postHook({ event: "PreToolUse" });
    expect(status).toBe(200);
    expect(data.state.state).toBe("awaiting-approval");
  });
});
