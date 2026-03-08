/**
 * End-to-end approval workflow tests.
 *
 * Validates that:
 *   1. PreToolUse hook clears the gate file
 *   2. Socket.io approve/deny/cancel actions write the gate file
 *   3. State transitions match the expected approval flow
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createApp, type DeckyApp } from "../app.js";
import {
  clearGateFile,
  gateFileExists,
  GATE_FILE_PATH,
} from "../approval-gate.js";
import { readFileSync } from "node:fs";
import { getBridgeToken } from "../security.js";

let decky: DeckyApp;
let baseUrl: string;
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
});

async function postHook(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-decky-token": token },
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

function waitForState(sock: ClientSocket, targetState: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for state: ${targetState}`)), 3000);
    sock.on("stateChange", (snapshot: { state: string }) => {
      if (snapshot.state === targetState) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

describe("approval workflow — gate file", () => {
  it("PreToolUse clears any stale gate file", async () => {
    // Create a stale gate file
    const { writeGateFile: write } = await import("../approval-gate.js");
    write("approve");
    expect(gateFileExists()).toBe(true);

    // POST PreToolUse — should clear it
    await postHook({ event: "PreToolUse", tool: "Bash" });
    expect(gateFileExists()).toBe(false);
  });

  it("approve action writes 'approve' to gate file", async () => {
    // Enter awaiting-approval state
    await postHook({ event: "PreToolUse", tool: "Bash" });

    const sock = await connectClient();
    const statePromise = waitForState(sock, "tool-executing");

    sock.emit("action", { action: "approve" });
    await statePromise;

    expect(gateFileExists()).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
    sock.disconnect();
  });

  it("deny action writes 'deny' to gate file", async () => {
    // Enter awaiting-approval state
    await postHook({ event: "PreToolUse", tool: "Bash" });

    const sock = await connectClient();
    const statePromise = waitForState(sock, "thinking");

    sock.emit("action", { action: "deny" });
    await statePromise;

    expect(gateFileExists()).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("deny");
    sock.disconnect();
  });

  it("cancel action writes 'cancel' to gate file", async () => {
    // Enter awaiting-approval state
    await postHook({ event: "PreToolUse", tool: "Bash" });

    const sock = await connectClient();
    const statePromise = waitForState(sock, "stopped");

    sock.emit("action", { action: "cancel" });
    await statePromise;

    expect(gateFileExists()).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("cancel");
    sock.disconnect();
  });

  it("approveOnceInClaude writes 'approve' and transitions to tool-executing", async () => {
    await postHook({ event: "PreToolUse", tool: "Bash" });

    const sock = await connectClient();
    const statePromise = waitForState(sock, "tool-executing");
    sock.emit("action", { action: "approveOnceInClaude" });
    await statePromise;

    expect(gateFileExists()).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
    sock.disconnect();
  });
});

describe("approval workflow — full cycle", () => {
  it("approve: idle → awaiting-approval → tool-executing → thinking → idle", async () => {
    // Force reset to idle (previous tests may leave state as stopped)
    decky.sm.forceState("idle", "test reset");

    const { data: s0 } = await postHook({ event: "PreToolUse", tool: "Write" });
    expect(s0.state.state).toBe("awaiting-approval");

    const sock = await connectClient();
    const execPromise = waitForState(sock, "tool-executing");
    sock.emit("action", { action: "approve" });
    await execPromise;

    // Tool completes
    const { data: s2 } = await postHook({ event: "PostToolUse", tool: "Write" });
    expect(s2.state.state).toBe("thinking");

    // Session ends
    const { data: s3 } = await postHook({ event: "Stop" });
    expect(s3.state.state).toBe("idle");
    sock.disconnect();
  });

  it("deny: idle → awaiting-approval → thinking → idle", async () => {
    decky.sm.forceState("idle", "test reset");

    const { data: s0 } = await postHook({ event: "PreToolUse", tool: "Bash" });
    expect(s0.state.state).toBe("awaiting-approval");

    const sock = await connectClient();
    const thinkPromise = waitForState(sock, "thinking");
    sock.emit("action", { action: "deny" });
    await thinkPromise;

    // Gate file should show deny
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("deny");

    const { data: s2 } = await postHook({ event: "Stop" });
    expect(s2.state.state).toBe("idle");
    sock.disconnect();
  });
});
