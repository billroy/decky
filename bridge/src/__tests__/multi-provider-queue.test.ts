/**
 * Approval queue tests.
 *
 * Validates:
 *   1. App surfacing on initial approval arrival
 *   2. App surfacing on queue advance (after approve/deny/stop)
 *   3. No surfacing for requests that aren't at the top of the queue
 *   4. Correct metadata propagation through the queue
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { getBridgeToken } from "../security.js";
import { clearGateFile } from "../approval-gate.js";
import { saveConfig } from "../config.js";

const macroMocks = vi.hoisted(() => ({
  approve: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  dismiss: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  surface: vi.fn<(targetApp: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("../macro-exec.js", () => ({
  executeMacro: vi.fn().mockResolvedValue(undefined),
  approveOnceInClaude: macroMocks.approve,
  dismissClaudeApproval: macroMocks.dismiss,
  surfaceTargetApp: macroMocks.surface,
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
  saveConfig({ popUpApp: true }); // enable app surfacing for these tests
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
  saveConfig({ popUpApp: true }); // keep surfacing enabled for these tests
  macroMocks.approve.mockClear();
  macroMocks.dismiss.mockClear();
  macroMocks.surface.mockClear();
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

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve) => {
    client = ioClient(baseUrl, { forceNew: true, auth: { token } });
    client.on("connect", () => resolve(client));
  });
}

function waitForState(sock: ClientSocket, targetState: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for state: ${targetState}`)), 3000);
    sock.on("stateChange", (snapshot: Record<string, unknown>) => {
      if ((snapshot as { state: string }).state === targetState) {
        clearTimeout(timeout);
        resolve(snapshot);
      }
    });
  });
}

describe("approval queue — app surfacing on arrival", () => {
  it("surfaces Claude app when request arrives at top of queue", async () => {
    await postHook({ event: "PermissionRequest", tool: "Bash" });

    expect(macroMocks.surface).toHaveBeenCalledOnce();
    expect(macroMocks.surface).toHaveBeenCalledWith("claude");
  });

  it("does NOT surface again for duplicate hook request while awaiting", async () => {
    // First request: Claude (becomes active, surfaces)
    await postHook({ event: "PermissionRequest", tool: "Bash" });
    expect(macroMocks.surface).toHaveBeenCalledOnce();
    expect(macroMocks.surface).toHaveBeenCalledWith("claude");

    macroMocks.surface.mockClear();

    // Second hook-source request while awaiting is a duplicate (duplicatePre guard)
    await postHook({ event: "PermissionRequest", tool: "Write" });
    expect(macroMocks.surface).not.toHaveBeenCalled();
  });
});

describe("approval queue — app surfacing on queue advance", () => {
  it("surfaces app for each new gate flow request cycle", async () => {
    // First cycle: request → approve → surfaces on arrival
    await postHook(
      { event: "PreToolUse", tool: "Bash" },
      { "x-decky-approval-flow": "gate" },
    );
    expect(macroMocks.surface).toHaveBeenCalledWith("claude");

    const sock = await connectClient();
    const execPromise = waitForState(sock, "tool-executing");
    sock.emit("action", { action: "approve" });
    await execPromise;

    // PostToolUse resets to idle
    await postHook(
      { event: "PostToolUse", tool: "Bash" },
      { "x-decky-approval-flow": "gate" },
    );

    macroMocks.surface.mockClear();

    // Second cycle: new request → surfaces on arrival
    await postHook(
      { event: "PreToolUse", tool: "Write" },
      { "x-decky-approval-flow": "gate" },
    );
    expect(macroMocks.surface).toHaveBeenCalledWith("claude");

    sock.disconnect();
  });

  it("does NOT surface app when queue empties after approve", async () => {
    // Single Claude request via gate flow
    await postHook(
      { event: "PreToolUse", tool: "Bash" },
      { "x-decky-approval-flow": "gate" },
    );
    macroMocks.surface.mockClear();

    const sock = await connectClient();
    const statePromise = waitForState(sock, "tool-executing");
    sock.emit("action", { action: "approve" });
    await statePromise;

    // Queue is empty after approval — no additional surfacing
    expect(macroMocks.surface).not.toHaveBeenCalled();
    sock.disconnect();
  });
});

describe("approval queue — metadata propagation", () => {
  it("approval metadata reflects pending count and flow", async () => {
    // Enqueue Claude request
    const { data: s0 } = await postHook({ event: "PermissionRequest", tool: "Bash" });
    expect(s0.state.approval).not.toBeNull();
    expect(s0.state.approval.pending).toBe(1);

    // /status returns statePayload directly (not nested under .state)
    const res = await fetch(`${baseUrl}/status`, {
      headers: { "x-decky-token": token },
    });
    const status = await res.json();
    expect(status.approval.pending).toBe(1);
    expect(status.approval.flow).toBe("mirror");
  });
});
