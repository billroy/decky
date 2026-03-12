/**
 * End-to-end approval workflow tests.
 *
 * Validates that:
 *   1. Gate flow: PreToolUse hook clears the gate file, approve/deny/cancel write it
 *   2. Mirror flow (default): PreToolUse is informational (no state change),
 *      PermissionRequest triggers approval UI
 *   3. State transitions match the expected approval flow
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import {
  clearGateFile,
  gateFileExists,
  GATE_FILE_PATH,
  clearQuestionResponse,
  readQuestionResponse,
} from "../approval-gate.js";
import { saveConfig } from "../config.js";
import { readFileSync } from "node:fs";
import { getBridgeToken } from "../security.js";

vi.mock("../macro-exec.js", () => ({
  executeMacro: vi.fn().mockResolvedValue(undefined),
  approveOnceInClaude: vi.fn().mockResolvedValue(undefined),
  dismissClaudeApproval: vi.fn().mockResolvedValue(undefined),
  approveInTargetApp: vi.fn().mockResolvedValue(undefined),
  dismissApprovalInTargetApp: vi.fn().mockResolvedValue(undefined),
  surfaceTargetApp: vi.fn().mockResolvedValue(undefined),
  setApprovalAttemptLogger: vi.fn(),
  withApprovalAttemptContext: vi.fn(async (_actionId: string, fn: () => Promise<void>) => await fn()),
  startDictationForClaude: vi.fn().mockResolvedValue(undefined),
}));

const { createApp } = await import("../app.js");
const { approveOnceInClaude: mockApproveOnce } = await import("../macro-exec.js");
type DeckyApp = ReturnType<typeof createApp>;

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
  clearQuestionResponse();
  decky.sm.forceState("idle", "test cleanup");
  saveConfig({ enableApproveOnce: true, enableDictation: true });
});

async function postHook(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-decky-token": token, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

/** Post a hook event using the legacy gate approval flow. */
async function postHookGate(body: Record<string, unknown>) {
  return postHook(body, { "x-decky-approval-flow": "gate" });
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

describe("approval workflow — gate file (legacy, explicit header)", () => {
  it("PreToolUse with gate flow clears any stale gate file", async () => {
    const { writeGateFile: write } = await import("../approval-gate.js");
    write("approve");
    expect(gateFileExists()).toBe(true);

    await postHookGate({ event: "PreToolUse", tool: "Bash" });
    expect(gateFileExists()).toBe(false);
  });

  it("approve action writes 'approve' to gate file", async () => {
    await postHookGate({ event: "PreToolUse", tool: "Bash" });

    const sock = await connectClient();
    const statePromise = waitForState(sock, "tool-executing");

    sock.emit("action", { action: "approve" });
    await statePromise;

    expect(gateFileExists()).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
    sock.disconnect();
  });

  it("deny action writes 'deny' to gate file", async () => {
    await postHookGate({ event: "PreToolUse", tool: "Bash" });

    const sock = await connectClient();
    const statePromise = waitForState(sock, "idle");

    sock.emit("action", { action: "deny" });
    await statePromise;

    expect(gateFileExists()).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("deny");
    sock.disconnect();
  });

  it("cancel action writes 'cancel' to gate file", async () => {
    await postHookGate({ event: "PreToolUse", tool: "Bash" });

    const sock = await connectClient();
    const statePromise = waitForState(sock, "stopped");

    sock.emit("action", { action: "cancel" });
    await statePromise;

    expect(gateFileExists()).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("cancel");
    sock.disconnect();
  });

  it("approveOnceInClaude writes 'approve' and transitions to tool-executing", async () => {
    await postHookGate({ event: "PreToolUse", tool: "Bash" });

    const sock = await connectClient();
    const statePromise = waitForState(sock, "tool-executing");
    sock.emit("action", { action: "approveOnceInClaude" });
    await statePromise;

    expect(gateFileExists()).toBe(true);
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
    sock.disconnect();
  });

  it("approveOnceInClaude outside awaiting-approval does not write gate file", async () => {
    decky.sm.forceState("idle", "test reset");
    const sock = await connectClient();
    sock.emit("action", { action: "approveOnceInClaude" });
    await new Promise((r) => setTimeout(r, 150));
    expect(gateFileExists()).toBe(false);
    sock.disconnect();
  });
});

describe("approval workflow — mirror flow (default)", () => {
  it("PreToolUse in mirror flow does NOT transition to awaiting-approval", async () => {
    decky.sm.forceState("idle", "test reset");
    const { data } = await postHook({ event: "PreToolUse", tool: "Bash" });
    // Mirror PreToolUse is informational only — state stays idle
    expect(data.state.state).toBe("idle");
    expect(data.state.approval).toBeNull();
  });

  it("PreToolUse in mirror flow does NOT clear gate file", async () => {
    const { writeGateFile: write } = await import("../approval-gate.js");
    write("approve");
    expect(gateFileExists()).toBe(true);

    await postHook({ event: "PreToolUse", tool: "Bash" });
    expect(gateFileExists()).toBe(true);
  });

  it("PermissionRequest transitions to awaiting-approval", async () => {
    decky.sm.forceState("idle", "test reset");
    const { data } = await postHook({ event: "PermissionRequest", tool: "Bash" });
    expect(data.state.state).toBe("awaiting-approval");
    expect(data.state.approval).not.toBeNull();
    expect(data.state.approval?.flow).toBe("mirror");
  });

  it("PermissionRequest from thinking transitions to awaiting-approval", async () => {
    decky.sm.forceState("thinking", "test reset");
    const { data } = await postHook({ event: "PermissionRequest", tool: "Write" });
    expect(data.state.state).toBe("awaiting-approval");
    expect(data.state.previousState).toBe("thinking");
  });

  it("PostToolUse after PermissionRequest transitions to idle", async () => {
    decky.sm.forceState("idle", "test reset");
    await postHook({ event: "PermissionRequest", tool: "Bash" });

    const { data } = await postHook({ event: "PostToolUse", tool: "Bash" });
    expect(data.state.state).toBe("idle");
  });

  it("PostToolUse from idle (auto-approved tool, no PermissionRequest) stays idle", async () => {
    decky.sm.forceState("idle", "test reset");
    // No PermissionRequest — this was an auto-approved tool
    const { data } = await postHook({ event: "PostToolUse", tool: "Read" });
    expect(data.state.state).toBe("idle");
  });

  it("explicit gate header still works for legacy flow", async () => {
    const { data } = await postHookGate({ event: "PreToolUse", tool: "Bash" });
    expect(data.state.approval?.flow).toBe("gate");
    expect(data.state.state).toBe("awaiting-approval");
  });
});

describe("approval workflow — full cycle (gate flow)", () => {
  it("approve: idle → awaiting-approval → tool-executing → thinking → idle", async () => {
    decky.sm.forceState("idle", "test reset");

    const { data: s0 } = await postHookGate({ event: "PreToolUse", tool: "Write" });
    expect(s0.state.state).toBe("awaiting-approval");

    const sock = await connectClient();
    const execPromise = waitForState(sock, "tool-executing");
    sock.emit("action", { action: "approve" });
    await execPromise;

    const { data: s2 } = await postHookGate({ event: "PostToolUse", tool: "Write" });
    expect(s2.state.state).toBe("idle");
    sock.disconnect();
  });

  it("deny: idle → awaiting-approval → idle", async () => {
    decky.sm.forceState("idle", "test reset");

    const { data: s0 } = await postHookGate({ event: "PreToolUse", tool: "Bash" });
    expect(s0.state.state).toBe("awaiting-approval");

    const sock = await connectClient();
    const idlePromise = waitForState(sock, "idle");
    sock.emit("action", { action: "deny" });
    await idlePromise;

    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("deny");
    sock.disconnect();
  });

  it("new PreToolUse after cancel re-enters awaiting-approval and accepts approve", async () => {
    decky.sm.forceState("idle", "test reset");

    await postHookGate({ event: "PreToolUse", tool: "Bash" });
    const sock = await connectClient();
    const stoppedPromise = waitForState(sock, "stopped");
    sock.emit("action", { action: "cancel" });
    await stoppedPromise;

    const { data: s1 } = await postHookGate({ event: "PreToolUse", tool: "Bash" });
    expect(s1.state.state).toBe("awaiting-approval");

    const execPromise = waitForState(sock, "tool-executing");
    sock.emit("action", { action: "approve" });
    await execPromise;
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
    sock.disconnect();
  });

  it("new PreToolUse from tool-executing re-enters awaiting-approval and accepts approve", async () => {
    decky.sm.forceState("tool-executing", "test reset");

    const { data: s1 } = await postHookGate({ event: "PreToolUse", tool: "Bash" });
    expect(s1.state.state).toBe("awaiting-approval");
    expect(s1.state.previousState).toBe("tool-executing");

    const sock = await connectClient();
    const execPromise = waitForState(sock, "tool-executing");
    sock.emit("action", { action: "approve" });
    await execPromise;
    expect(readFileSync(GATE_FILE_PATH, "utf-8")).toBe("approve");
    sock.disconnect();
  });
});

describe("approval workflow — mirror full cycle (PermissionRequest)", () => {
  it("PermissionRequest → PostToolUse full cycle", async () => {
    decky.sm.forceState("idle", "test reset");

    const { data: s0 } = await postHook({ event: "PermissionRequest", tool: "Write" });
    expect(s0.state.state).toBe("awaiting-approval");

    // Simulate approval handled (either in Claude or on deck) — PostToolUse follows
    const { data: s1 } = await postHook({ event: "PostToolUse", tool: "Write" });
    expect(s1.state.state).toBe("idle");
  });

  it("approved in Claude (PostToolUse while awaiting): awaiting-approval → idle", async () => {
    decky.sm.forceState("idle", "test reset");

    await postHook({ event: "PermissionRequest", tool: "Bash" });

    // User approved in Claude directly — PostToolUse arrives while awaiting-approval
    const { data } = await postHook({ event: "PostToolUse", tool: "Bash" });
    expect(data.state.state).toBe("idle");
  });

  it("auto-approved tool does NOT flash approval (PreToolUse → PostToolUse, no PermissionRequest)", async () => {
    decky.sm.forceState("idle", "test reset");

    // PreToolUse in mirror is a no-op
    const { data: s0 } = await postHook({ event: "PreToolUse", tool: "Read" });
    expect(s0.state.state).toBe("idle");

    // PostToolUse arrives — stays idle (thinking state disabled)
    const { data: s1 } = await postHook({ event: "PostToolUse", tool: "Read" });
    expect(s1.state.state).toBe("idle");
  });

  describe("tool risk classification", () => {
    beforeEach(() => {
      decky.sm.forceState("idle", "test reset");
    });

    it("riskLevel is null when no rules are configured", async () => {
      saveConfig({ toolRiskRules: [] });
      const { data } = await postHook({ event: "PermissionRequest", tool: "Bash" });
      expect(data.state.approval).not.toBeNull();
      expect(data.state.approval!.riskLevel).toBeNull();
    });

    it("riskLevel matches configured pattern (warning for Bash)", async () => {
      saveConfig({ toolRiskRules: [{ pattern: "Bash", risk: "warning" }] });
      const { data } = await postHook({ event: "PermissionRequest", tool: "Bash" });
      expect(data.state.approval!.riskLevel).toBe("warning");
    });

    it("riskLevel matches critical pattern (WriteFile → critical)", async () => {
      saveConfig({ toolRiskRules: [
        { pattern: "^Write", risk: "critical" },
        { pattern: "Bash", risk: "warning" },
      ] });
      const { data } = await postHook({ event: "PermissionRequest", tool: "WriteFile" });
      expect(data.state.approval!.riskLevel).toBe("critical");
    });

    it("riskLevel is null for unmatched tool", async () => {
      saveConfig({ toolRiskRules: [{ pattern: "Bash", risk: "warning" }] });
      const { data } = await postHook({ event: "PermissionRequest", tool: "Read" });
      expect(data.state.approval!.riskLevel).toBeNull();
    });

    it("first matching rule wins", async () => {
      saveConfig({ toolRiskRules: [
        { pattern: "Bash", risk: "safe" },
        { pattern: "Bash", risk: "critical" },
      ] });
      const { data } = await postHook({ event: "PermissionRequest", tool: "Bash" });
      expect(data.state.approval!.riskLevel).toBe("safe");
    });
  });
});

describe("AskUserQuestion — asking state + selectOption action", () => {
  function connectClient(): Promise<ClientSocket> {
    return new Promise((resolve) => {
      const sock = ioClient(baseUrl, { auth: { token } });
      sock.once("connect", () => resolve(sock));
    });
  }

  function waitForState(sock: ClientSocket, targetState: string): Promise<unknown> {
    return new Promise((resolve) => {
      sock.on("stateChange", (snap: { state: string }) => {
        if (snap.state === targetState) resolve(snap);
      });
    });
  }

  beforeEach(() => {
    decky.sm.forceState("idle", "test reset");
  });

  it("AskUserQuestion transitions to asking state", async () => {
    const { data } = await postHook({
      event: "AskUserQuestion",
      question: "Which approach?",
      options: [{ label: "Option A" }, { label: "Option B" }],
    });
    expect(data.state.state).toBe("asking");
    expect(data.state.question).not.toBeNull();
    expect(data.state.question.text).toBe("Which approach?");
    expect(data.state.question.options).toHaveLength(2);
    expect(data.state.question.options[0].label).toBe("Option A");
    expect(data.state.question.options[1].label).toBe("Option B");
  });

  it("AskUserQuestion options are capped at 8", async () => {
    const options = Array.from({ length: 12 }, (_, i) => ({ label: `Option ${i + 1}` }));
    const { data } = await postHook({ event: "AskUserQuestion", question: "Pick one", options });
    expect(data.state.question.options).toHaveLength(8);
  });

  it("selectOption writes response file and transitions to idle", async () => {
    await postHook({
      event: "AskUserQuestion",
      question: "Choose",
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
    });
    expect(decky.sm.getSnapshot().state).toBe("asking");

    const sock = await connectClient();
    const idlePromise = waitForState(sock, "idle");
    sock.emit("action", { action: "selectOption", index: 1 });
    await idlePromise;

    expect(readQuestionResponse()).toBe("1");
    expect(decky.sm.getSnapshot().state).toBe("idle");
    sock.disconnect();
  });

  it("selectOption in wrong state emits error", async () => {
    decky.sm.forceState("idle", "test reset");  // not asking

    const sock = await connectClient();
    const errorPromise = new Promise<{ error: string }>((resolve) => {
      sock.once("error", resolve);
    });
    sock.emit("action", { action: "selectOption", index: 0 });
    const err = await errorPromise;
    expect(err.error).toContain("not in asking state");
    sock.disconnect();
  });

  it("selectOption with out-of-range index emits error", async () => {
    await postHook({
      event: "AskUserQuestion",
      question: "Pick",
      options: [{ label: "A" }, { label: "B" }],
    });

    const sock = await connectClient();
    const errorPromise = new Promise<{ error: string }>((resolve) => {
      sock.once("error", resolve);
    });
    sock.emit("action", { action: "selectOption", index: 5 });
    const err = await errorPromise;
    expect(err.error).toContain("out of range");
    sock.disconnect();
  });

  it("Stop while asking clears question and transitions to idle", async () => {
    await postHook({
      event: "AskUserQuestion",
      question: "Choose",
      options: [{ label: "A" }],
    });
    expect(decky.sm.getSnapshot().state).toBe("asking");

    const { data } = await postHook({ event: "Stop" });
    expect(data.state.state).toBe("idle");
    expect(data.state.question).toBeNull();
  });
});

