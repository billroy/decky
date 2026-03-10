import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp, type DeckyApp } from "../app.js";
import { getBridgeToken } from "../security.js";

let decky: DeckyApp;
let baseUrl: string;
const token = getBridgeToken();

beforeAll(async () => {
  decky = createApp();
  await new Promise<void>((resolve) => {
    decky.httpServer.listen(0, "127.0.0.1", () => resolve()); // random port
  });
  const addr = decky.httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  decky.io.close();
  await new Promise<void>((resolve) => decky.httpServer.close(() => resolve()));
});

async function postHook(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-decky-token": token, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function getStatus() {
  const res = await fetch(`${baseUrl}/status`, { headers: { "x-decky-token": token } });
  return { status: res.status, data: await res.json() };
}

describe("GET /status", () => {
  it("returns idle state initially", async () => {
    const { status, data } = await getStatus();
    expect(status).toBe(200);
    expect(data.state).toBe("idle");
    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("codex");
    expect(data.codex).toHaveProperty("mode", "app-server");
    expect(data.codex).toHaveProperty("enabled", false);
    expect(data.codex.provider).toHaveProperty("state", "disabled");
    expect(data.codex.compatibility).toBeDefined();
    expect(data.codex.autoResume).toBeDefined();
    expect(data.codex.supervisor).toBeDefined();
  });
});

describe("GET /debug/codex-provider", () => {
  it("returns codex provider health and lifecycle trace", async () => {
    const res = await fetch(`${baseUrl}/debug/codex-provider`, {
      headers: { "x-decky-token": token },
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.codexProvider).toBeDefined();
    expect(data.codexProvider.mode).toBe("app-server");
    expect(data.codexProvider.enabled).toBe(false);
    expect(data.codexProvider.provider.state).toBe("disabled");
    expect(data.codexProvider.compatibility).toBeDefined();
    expect(data.codexProvider.autoResume).toBeDefined();
    expect(Array.isArray(data.lifecycle)).toBe(true);
  });
});

describe("POST /hook", () => {
  it("accepts PermissionRequest and transitions to awaiting-approval", async () => {
    const { status, data } = await postHook({ event: "PermissionRequest", tool: "Bash" });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.state.state).toBe("awaiting-approval");
    expect(data.state.tool).toBe("Bash");
  });

  it("PreToolUse in mirror flow stays idle (informational only)", async () => {
    decky.sm.forceState("idle", "test reset");
    const { status, data } = await postHook({ event: "PreToolUse", tool: "Bash" });
    expect(status).toBe(200);
    expect(data.state.state).toBe("idle");
  });

  it("state persists — status reflects awaiting-approval", async () => {
    await postHook({ event: "PermissionRequest", tool: "Bash" });
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
  });

  it("accepts PostToolUse and transitions to idle", async () => {
    const { data } = await postHook({ event: "PostToolUse", tool: "Bash" });
    expect(data.state.state).toBe("idle");
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
    const { status, data } = await postHook({ event: "PermissionRequest" });
    expect(status).toBe(200);
    expect(data.state.state).toBe("awaiting-approval");
  });

  it("accepts hook_event_name fallback", async () => {
    const { status, data } = await postHook({ hook_event_name: "PermissionRequest", tool_name: "Bash" });
    expect(status).toBe(200);
    expect(data.state.state).toBe("awaiting-approval");
    expect(data.state.tool).toBe("Bash");
  });

  it("accepts x-decky-event header fallback", async () => {
    const { status, data } = await postHook({}, { "x-decky-event": "PostToolUse" });
    expect(status).toBe(200);
    expect(data.state.state).toBe("idle");
  });

  it("drains hook mirror queue on PostToolUse even when tool labels differ", async () => {
    decky.sm.forceState("idle", "test reset");

    const pre = await postHook(
      { event: "PermissionRequest", tool: "Agent" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(pre.status).toBe(200);
    expect(pre.data.state.state).toBe("awaiting-approval");
    expect(pre.data.state.approval?.pending).toBe(1);

    const post = await postHook({ event: "PostToolUse", tool: "Bash" });
    expect(post.status).toBe(200);
    expect(post.data.state.state).toBe("idle");
    expect(post.data.state.approval).toBeNull();
  });

  it("rejects unauthorized requests", async () => {
    const res = await fetch(`${baseUrl}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "PreToolUse" }),
    });
    expect(res.status).toBe(401);
  });
});
