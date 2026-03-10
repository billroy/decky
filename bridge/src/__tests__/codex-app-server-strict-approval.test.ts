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

let createApp: (typeof import("../app.js"))["createApp"];
let decky: ReturnType<(typeof import("../app.js"))["createApp"]>;
let baseUrl: string;
let client: ClientSocket;
const token = getBridgeToken();

const prevIntegration = process.env.DECKY_CODEX_INTEGRATION;

beforeAll(async () => {
  process.env.DECKY_CODEX_INTEGRATION = "app-server";
  vi.resetModules();
  ({ createApp } = await import("../app.js"));
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

  if (typeof prevIntegration === "string") process.env.DECKY_CODEX_INTEGRATION = prevIntegration;
  else delete process.env.DECKY_CODEX_INTEGRATION;
});

afterEach(() => {
  clearGateFile();
  decky.sm.forceState("idle", "test cleanup");
  macroMocks.approve.mockClear();
  macroMocks.dismiss.mockClear();
  macroMocks.approveTarget.mockClear();
  macroMocks.dismissTarget.mockClear();
});

async function postHook(body: Record<string, unknown>, headers: Record<string, string> = {}) {
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

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve) => {
    client = ioClient(baseUrl, { forceNew: true, auth: { token } });
    client.on("connect", () => resolve(client));
  });
}

function waitForSocketEvent<T>(socket: ClientSocket, event: string, timeoutMs = 800): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for socket event: ${event}`)), timeoutMs);
    socket.once(event, (payload: unknown) => {
      clearTimeout(timeout);
      resolve(payload as T);
    });
  });
}

describe("codex app-server strict approval routing", () => {
  it("deny in mirror codex flow fails fast when app-server request id is missing", async () => {
    const pre = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror", "x-decky-target-app": "codex" },
    );
    expect(pre.status).toBe(200);

    const sock = await connectClient();
    const errPromise = waitForSocketEvent<{ error: string }>(sock, "error");
    sock.emit("action", { action: "deny" });
    const err = await errPromise;

    expect(err.error).toContain("missing app-server request ID");
    expect(macroMocks.dismissTarget).not.toHaveBeenCalled();
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });

  it("cancel in mirror codex flow fails fast when app-server request id is missing", async () => {
    const pre = await postHook(
      { event: "PermissionRequest", tool: "Write" },
      { "x-decky-approval-flow": "mirror", "x-decky-target-app": "codex" },
    );
    expect(pre.status).toBe(200);

    const sock = await connectClient();
    const errPromise = waitForSocketEvent<{ error: string }>(sock, "error");
    sock.emit("action", { action: "cancel" });
    const err = await errPromise;

    expect(err.error).toContain("missing app-server request ID");
    expect(macroMocks.dismissTarget).not.toHaveBeenCalled();
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });
});
