import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { getBridgeToken } from "../security.js";
import { clearGateFile, gateFileExists } from "../approval-gate.js";

const macroMocks = vi.hoisted(() => ({
  approve: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  dismiss: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  approveTarget: vi.fn<(targetApp: "claude" | "codex") => Promise<void>>().mockResolvedValue(undefined),
  dismissTarget: vi.fn<(targetApp: "claude" | "codex") => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("../macro-exec.js", () => ({
  executeMacro: vi.fn().mockResolvedValue(undefined),
  approveOnceInClaude: macroMocks.approve,
  dismissClaudeApproval: macroMocks.dismiss,
  approveInTargetApp: macroMocks.approveTarget,
  dismissApprovalInTargetApp: macroMocks.dismissTarget,
  setApprovalAttemptLogger: vi.fn(),
  withApprovalAttemptContext: vi.fn(async (_actionId: string, fn: () => Promise<void>) => await fn()),
  startDictationForClaude: vi.fn().mockResolvedValue(undefined),
}));

const { createApp } = await import("../app.js");

let baseUrl: string;
let decky: ReturnType<typeof createApp>;
let client: ClientSocket;
const token = getBridgeToken();

beforeAll(async () => {
  decky = createApp();
  await new Promise<void>((resolve) => {
    decky.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = decky.httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  client?.disconnect();
  decky.io.close();
  await new Promise<void>((resolve) => decky.httpServer.close(() => resolve()));
  clearGateFile();
});

afterEach(() => {
  clearGateFile();
  decky.sm.forceState("idle", "test cleanup");
  macroMocks.approve.mockClear();
  macroMocks.dismiss.mockClear();
  macroMocks.approveTarget.mockClear();
  macroMocks.dismissTarget.mockClear();
});

async function postHook(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${baseUrl}/hook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-decky-token": token,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function getStatus() {
  const res = await fetch(`${baseUrl}/status`, {
    headers: { "x-decky-token": token },
  });
  return { status: res.status, data: await res.json() };
}

async function getApprovalTrace(limit = 10) {
  const res = await fetch(`${baseUrl}/debug/approval-trace?limit=${limit}`, {
    headers: { "x-decky-token": token },
  });
  return { status: res.status, data: await res.json() };
}

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve) => {
    client = ioClient(baseUrl, { forceNew: true, auth: { token } });
    client.on("connect", () => resolve(client));
  });
}

function waitForSocketEvent<T>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 800,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for socket event: ${event}`));
    }, timeoutMs);
    socket.once(event, (payload: unknown) => {
      clearTimeout(timeout);
      resolve(payload as T);
    });
  });
}

describe("approval workflow — mirror mode", () => {
  it("approve action forwards to Claude and does not write gate/force state", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    sock.emit("action", { action: "approve" });
    await new Promise((r) => setTimeout(r, 100));

    expect(macroMocks.approve).toHaveBeenCalledOnce();
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });

  it("approve action fails fast for Codex when app-server request id is missing", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    const errorPromise = waitForSocketEvent<{ error: string }>(sock, "error");
    sock.emit("action", { action: "approve", targetApp: "codex" });
    const err = await errorPromise;

    expect(err.error).toContain("missing app-server request ID");
    expect(macroMocks.approve).not.toHaveBeenCalled();
    expect(macroMocks.approveTarget).not.toHaveBeenCalled();
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });

  it("approve action does not attempt Codex UI fallback when app-server request id is missing", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    const errorPromise = waitForSocketEvent<{ error: string }>(sock, "error");
    sock.emit("action", { action: "approve", targetApp: "codex" });

    const err = await errorPromise;
    expect(err.error).toContain("missing app-server request ID");
    expect(macroMocks.approveTarget).not.toHaveBeenCalled();
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });

  it("deny action dismisses Claude approval, clears approval UI, and does not write gate", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    sock.emit("action", { action: "deny" });
    await new Promise((r) => setTimeout(r, 100));

    expect(macroMocks.dismiss).toHaveBeenCalledOnce();
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("idle");
    sock.disconnect();
  });

  it("deny action fails fast for Codex when app-server request id is missing", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    const errorPromise = waitForSocketEvent<{ error: string }>(sock, "error");
    sock.emit("action", { action: "deny", targetApp: "codex" });
    const err = await errorPromise;

    expect(err.error).toContain("missing app-server request ID");
    expect(macroMocks.dismiss).not.toHaveBeenCalled();
    expect(macroMocks.dismissTarget).not.toHaveBeenCalled();
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });

  it("cancel action dismisses Claude approval, clears approval UI, and does not write gate", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    sock.emit("action", { action: "cancel" });
    await new Promise((r) => setTimeout(r, 100));

    expect(macroMocks.dismiss).toHaveBeenCalledOnce();
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("idle");
    sock.disconnect();
  });

  it("cancel action fails fast for Codex when app-server request id is missing", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    const errorPromise = waitForSocketEvent<{ error: string }>(sock, "error");
    sock.emit("action", { action: "cancel", targetApp: "codex" });
    const err = await errorPromise;

    expect(err.error).toContain("missing app-server request ID");
    expect(macroMocks.dismiss).not.toHaveBeenCalled();
    expect(macroMocks.dismissTarget).not.toHaveBeenCalled();
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });

  it("records action-level trace entries for codex mirror cancel", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    sock.emit("action", { action: "cancel", targetApp: "codex", actionId: "sd-trace-test-1" });
    await new Promise((r) => setTimeout(r, 120));

    const traceRes = await getApprovalTrace(20);
    expect(traceRes.status).toBe(200);
    const traces = Array.isArray(traceRes.data?.traces) ? traceRes.data.traces : [];
    const trace = traces.find((t: { actionId?: string }) => t.actionId === "sd-trace-test-1");
    expect(trace).toBeTruthy();
    expect(Array.isArray(trace.events)).toBe(true);
    expect(
      trace.events.some((e: { stage?: string }) => e.stage === "bridge.action.received")
    ).toBe(true);
    sock.disconnect();
  });

  it("mirror cancel keeps awaiting-approval when Codex request id is missing", async () => {
    const { status } = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    const errorPromise = waitForSocketEvent<{ error: string }>(sock, "error");
    sock.emit("action", { action: "cancel", targetApp: "codex" });
    const err = await errorPromise;

    expect(err.error).toContain("missing app-server request ID");
    expect(macroMocks.dismissTarget).not.toHaveBeenCalled();
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });

  it("ignores approval actions when awaiting-approval has no active queue context", async () => {
    decky.sm.forceState("awaiting-approval", "desync test", "Write");

    const sock = await connectClient();
    const errorPromise = waitForSocketEvent<{ error: string }>(sock, "error");
    sock.emit("action", { action: "approve" });
    const err = await errorPromise;

    expect(err.error).toContain("no active approval context");
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    expect(data.approval).toBeNull();
    sock.disconnect();
  });

  it("cancel action outside awaiting-approval transitions to stopped and dismisses target app", async () => {
    const pre = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      {
        "x-decky-approval-flow": "mirror",
        "x-decky-target-app": "codex",
      },
    );
    expect(pre.status).toBe(200);
    const post = await postHook(
      { event: "PostToolUse", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(post.status).toBe(200);

    const sock = await connectClient();
    sock.emit("action", { action: "cancel" });
    await new Promise((r) => setTimeout(r, 100));

    expect(macroMocks.dismiss).not.toHaveBeenCalled();
    expect(macroMocks.dismissTarget).toHaveBeenCalledOnce();
    expect(macroMocks.dismissTarget).toHaveBeenCalledWith("codex");
    const { data } = await getStatus();
    expect(data.state).toBe("stopped");
    sock.disconnect();
  });
});
