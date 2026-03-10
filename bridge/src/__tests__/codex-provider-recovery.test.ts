import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
type DeckyApp = ReturnType<typeof createApp>;

const token = getBridgeToken();
const ENV_KEYS = [
  "VITEST",
  "DECKY_ENABLE_CODEX_MONITOR",
  "DECKY_CODEX_APP_SERVER_COMMAND",
  "DECKY_CODEX_RESTART_MAX_ATTEMPTS",
  "DECKY_CODEX_RESTART_BASE_DELAY_MS",
  "DECKY_CODEX_RESTART_MAX_DELAY_MS",
] as const;

type SavedEnv = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

function saveEnv(): SavedEnv {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as SavedEnv;
}

function restoreEnv(saved: SavedEnv): void {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
}

async function listen(app: DeckyApp): Promise<string> {
  await new Promise<void>((resolve) => {
    app.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = app.httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

async function closeApp(app: DeckyApp): Promise<void> {
  app.io.close();
  await new Promise<void>((resolve) => app.httpServer.close(() => resolve()));
}

async function getJson(baseUrl: string, path: string): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "x-decky-token": token },
  });
  return await res.json();
}

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 3000,
  pollMs = 50,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error("Timed out waiting for condition");
}

function writeMockCodexCommand(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "decky-codex-mock-"));
  const file = join(dir, "codex-mock");
  writeFileSync(file, script, "utf8");
  chmodSync(file, 0o755);
  return file;
}

afterEach(() => {
  delete process.env.DECKY_CODEX_APP_SERVER_COMMAND;
});

describe("codex provider runtime recovery", () => {
  it("clears codex-origin pending approvals when provider exits unexpectedly", async () => {
    const saved = saveEnv();
    const mockCommand = writeMockCodexCommand(`#!/usr/bin/env node
process.stdin.setEncoding("utf8");
let buffer = "";
let sentApproval = false;
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const idx = buffer.indexOf("\\n");
    if (idx < 0) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === "decky-init" && msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ id: "decky-init", result: { protocolVersion: "1.0" } }) + "\\n");
      if (!sentApproval) {
        sentApproval = true;
        setTimeout(() => {
          process.stdout.write(JSON.stringify({
            id: "mock-approval-1",
            method: "item/commandExecution/requestApproval",
            params: { itemId: "item-1", commandActions: [{ type: "search" }] }
          }) + "\\n");
        }, 10);
        setTimeout(() => process.exit(17), 80);
      }
    }
  }
});
setInterval(() => {}, 1000);
`);

    process.env.VITEST = "false";
    process.env.DECKY_ENABLE_CODEX_MONITOR = "1";
    process.env.DECKY_CODEX_APP_SERVER_COMMAND = mockCommand;
    process.env.DECKY_CODEX_RESTART_MAX_ATTEMPTS = "0";

    const app = createApp();
    const baseUrl = await listen(app);

    try {
      await waitFor(async () => {
        const status = await getJson(baseUrl, "/status");
        return status.state === "awaiting-approval" && status.approval?.targetApp === "codex";
      });

      await waitFor(async () => {
        const status = await getJson(baseUrl, "/status");
        return status.state === "idle" && status.approval === null;
      });

      const final = await getJson(baseUrl, "/status");
      expect(final.state).toBe("idle");
      expect(final.approval).toBeNull();
      expect(["exit", "start-failed", "error"]).toContain(final.codex.provider.state);
    } finally {
      await closeApp(app);
      restoreEnv(saved);
    }
  });

  it("retries startup with bounded restart budget", async () => {
    const saved = saveEnv();
    process.env.VITEST = "false";
    process.env.DECKY_ENABLE_CODEX_MONITOR = "1";
    process.env.DECKY_CODEX_APP_SERVER_COMMAND = "__decky_missing_codex_binary__";
    process.env.DECKY_CODEX_RESTART_MAX_ATTEMPTS = "1";
    process.env.DECKY_CODEX_RESTART_BASE_DELAY_MS = "20";
    process.env.DECKY_CODEX_RESTART_MAX_DELAY_MS = "20";

    const app = createApp();
    const baseUrl = await listen(app);

    try {
      await waitFor(async () => {
        const debug = await getJson(baseUrl, "/debug/codex-provider");
        const lifecycle = Array.isArray(debug.lifecycle) ? debug.lifecycle : [];
        const starts = lifecycle.filter((entry: { state?: string }) => entry.state === "starting");
        return starts.length >= 2;
      }, 2500);

      const status = await getJson(baseUrl, "/status");
      expect(status.codex.supervisor.maxRetries).toBe(1);
      expect(status.codex.supervisor.retries).toBe(1);
      expect(typeof status.codex.supervisor.lastFailure).toBe("string");
    } finally {
      await closeApp(app);
      restoreEnv(saved);
    }
  });
});
