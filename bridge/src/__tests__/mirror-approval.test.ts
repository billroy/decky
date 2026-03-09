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

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve) => {
    client = ioClient(baseUrl, { forceNew: true, auth: { token } });
    client.on("connect", () => resolve(client));
  });
}

describe("approval workflow — mirror mode", () => {
  it("approve action forwards to Claude and does not write gate/force state", async () => {
    const { status } = await postHook(
      { event: "PreToolUse", tool: "Write" },
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

  it("approve action forwards to Codex when targetApp is codex", async () => {
    const { status } = await postHook(
      { event: "PreToolUse", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    sock.emit("action", { action: "approve", targetApp: "codex" });
    await new Promise((r) => setTimeout(r, 100));

    expect(macroMocks.approve).not.toHaveBeenCalled();
    expect(macroMocks.approveTarget).toHaveBeenCalledOnce();
    expect(macroMocks.approveTarget).toHaveBeenCalledWith("codex");
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("awaiting-approval");
    sock.disconnect();
  });

  it("deny action dismisses Claude approval, clears approval UI, and does not write gate", async () => {
    const { status } = await postHook(
      { event: "PreToolUse", tool: "Write" },
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

  it("deny action dismisses Codex approval when targetApp is codex", async () => {
    const { status } = await postHook(
      { event: "PreToolUse", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    sock.emit("action", { action: "deny", targetApp: "codex" });
    await new Promise((r) => setTimeout(r, 100));

    expect(macroMocks.dismiss).not.toHaveBeenCalled();
    expect(macroMocks.dismissTarget).toHaveBeenCalledOnce();
    expect(macroMocks.dismissTarget).toHaveBeenCalledWith("codex");
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("idle");
    sock.disconnect();
  });

  it("cancel action dismisses Claude approval, clears approval UI, and does not write gate", async () => {
    const { status } = await postHook(
      { event: "PreToolUse", tool: "Write" },
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

  it("cancel action dismisses Codex approval when targetApp is codex", async () => {
    const { status } = await postHook(
      { event: "PreToolUse", tool: "Write" },
      { "x-decky-approval-flow": "mirror" },
    );
    expect(status).toBe(200);

    const sock = await connectClient();
    sock.emit("action", { action: "cancel", targetApp: "codex" });
    await new Promise((r) => setTimeout(r, 100));

    expect(macroMocks.dismiss).not.toHaveBeenCalled();
    expect(macroMocks.dismissTarget).toHaveBeenCalledOnce();
    expect(macroMocks.dismissTarget).toHaveBeenCalledWith("codex");
    expect(gateFileExists()).toBe(false);
    const { data } = await getStatus();
    expect(data.state).toBe("idle");
    sock.disconnect();
  });

  it("cancel action outside awaiting-approval transitions to stopped and dismisses target app", async () => {
    const pre = await postHook(
      { event: "PreToolUse", tool: "Write" },
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
