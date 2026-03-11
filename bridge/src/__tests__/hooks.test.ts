/**
 * Tests for the Node.js hook scripts in hooks/*.js.
 *
 * Spawns each hook as a child process with stdin piped and a local HTTP server
 * to receive the POSTed events. Verifies exit codes, event delivery, and
 * fail-closed behavior.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const HOOKS_DIR = resolve(__dirname, "../../../hooks");
const TEST_HOME = resolve(process.cwd(), ".decky-test");
const TOKEN_FILE = join(TEST_HOME, "bridge-token");
const GATE_FILE = join(TEST_HOME, "approval-gate");
const TEST_TOKEN = "test-hook-token-12345678";

// Helper: run a hook script, return { code, stdout, stderr }
function runHook(
  scriptName: string,
  opts: {
    stdin?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      "node",
      [join(HOOKS_DIR, scriptName)],
      {
        timeout: opts.timeoutMs ?? 5000,
        env: {
          ...process.env,
          DECKY_HOME: TEST_HOME,
          DECKY_AUTH_TOKEN: TEST_TOKEN,
          ...opts.env,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (error as NodeJS.ErrnoException & { code?: number | string }).code === "ERR_CHILD_PROCESS_STDIO_FINAL_CLOSE"
            ? 0
            : (error.code as number) ?? 1 : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
    if (child.stdin) {
      child.stdin.write(opts.stdin ?? "{}");
      child.stdin.end();
    }
  });
}

// Minimal HTTP server that captures POSTed bodies
interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function createCaptureServer(): {
  server: Server;
  requests: CapturedRequest[];
  start: () => Promise<number>;
  stop: () => Promise<void>;
  respondWith: (statusCode: number) => void;
} {
  const requests: CapturedRequest[] = [];
  let responseCode = 200;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      requests.push({
        method: req.method ?? "?",
        url: req.url ?? "?",
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
      });
      res.writeHead(responseCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, state: { state: "idle" } }));
    });
  });

  return {
    server,
    requests,
    respondWith: (code: number) => { responseCode = code; },
    start: () => new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    }),
    stop: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}

// --- Tests ---

describe("simple hooks (non-blocking)", () => {
  let capture: ReturnType<typeof createCaptureServer>;
  let bridgeUrl: string;

  beforeAll(async () => {
    mkdirSync(TEST_HOME, { recursive: true });
    writeFileSync(TOKEN_FILE, TEST_TOKEN + "\n", "utf-8");
    capture = createCaptureServer();
    const port = await capture.start();
    bridgeUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await capture.stop();
  });

  beforeEach(() => {
    capture.requests.length = 0;
    capture.respondWith(200);
  });

  for (const [script, expectedEvent] of [
    ["post-tool-use.js", "PostToolUse"],
    ["stop.js", "Stop"],
    ["notification.js", "Notification"],
  ] as const) {
    it(`${script} exits 0 and POSTs ${expectedEvent}`, async () => {
      const result = await runHook(script, {
        stdin: JSON.stringify({ tool: "Bash" }),
        env: { DECKY_BRIDGE_URL: bridgeUrl },
      });
      expect(result.code).toBe(0);
      expect(capture.requests.length).toBe(1);
      expect(capture.requests[0].headers["x-decky-event"]).toBe(expectedEvent);
      expect(capture.requests[0].headers["x-decky-token"]).toBe(TEST_TOKEN);
      expect(capture.requests[0].body).toContain("Bash");
    });
  }

  it("permission-request.js exits 0 and POSTs PermissionRequest with mirror flow", async () => {
    const result = await runHook("permission-request.js", {
      stdin: JSON.stringify({ tool: "Write" }),
      env: { DECKY_BRIDGE_URL: bridgeUrl },
    });
    expect(result.code).toBe(0);
    expect(capture.requests.length).toBe(1);
    expect(capture.requests[0].headers["x-decky-event"]).toBe("PermissionRequest");
    expect(capture.requests[0].headers["x-decky-approval-flow"]).toBe("mirror");
  });

  it("simple hooks exit 0 even when bridge is unreachable", async () => {
    const result = await runHook("post-tool-use.js", {
      stdin: "{}",
      env: { DECKY_BRIDGE_URL: "http://127.0.0.1:1" }, // port 1 = unreachable
    });
    expect(result.code).toBe(0);
  });

  it("reads token from file when DECKY_AUTH_TOKEN is not set", async () => {
    const result = await runHook("notification.js", {
      stdin: "{}",
      env: {
        DECKY_BRIDGE_URL: bridgeUrl,
        DECKY_AUTH_TOKEN: "", // clear env token to force file read
      },
    });
    expect(result.code).toBe(0);
    expect(capture.requests.length).toBe(1);
    expect(capture.requests[0].headers["x-decky-token"]).toBe(TEST_TOKEN);
  });
});

describe("pre-tool-use.js", () => {
  let capture: ReturnType<typeof createCaptureServer>;
  let bridgeUrl: string;

  beforeAll(async () => {
    mkdirSync(TEST_HOME, { recursive: true });
    writeFileSync(TOKEN_FILE, TEST_TOKEN + "\n", "utf-8");
    capture = createCaptureServer();
    const port = await capture.start();
    bridgeUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await capture.stop();
    try { unlinkSync(GATE_FILE); } catch { /* ignore */ }
  });

  beforeEach(() => {
    capture.requests.length = 0;
    capture.respondWith(200);
    try { unlinkSync(GATE_FILE); } catch { /* ignore */ }
  });

  it("exits 0 in mirror mode (default) after posting to bridge", async () => {
    const result = await runHook("pre-tool-use.js", {
      stdin: JSON.stringify({ tool: "Bash" }),
      env: { DECKY_BRIDGE_URL: bridgeUrl },
    });
    expect(result.code).toBe(0);
    expect(capture.requests.length).toBe(1);
    expect(capture.requests[0].headers["x-decky-event"]).toBe("PreToolUse");
    expect(capture.requests[0].headers["x-decky-approval-flow"]).toBe("mirror");
  });

  it("exits 2 when bridge is down (fail-closed)", async () => {
    const result = await runHook("pre-tool-use.js", {
      stdin: "{}",
      env: { DECKY_BRIDGE_URL: "http://127.0.0.1:1" },
    });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("bridge unavailable");
  });

  it("exits 2 when bridge returns 401 (fail-closed)", async () => {
    capture.respondWith(401);
    const result = await runHook("pre-tool-use.js", {
      stdin: "{}",
      env: { DECKY_BRIDGE_URL: bridgeUrl },
    });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("unauthorized");
  });

  it("includes nonce header in POST", async () => {
    await runHook("pre-tool-use.js", {
      stdin: "{}",
      env: { DECKY_BRIDGE_URL: bridgeUrl },
    });
    expect(capture.requests.length).toBe(1);
    const nonceHeader = capture.requests[0].headers["x-decky-nonce"];
    expect(typeof nonceHeader).toBe("string");
    expect((nonceHeader as string).length).toBeGreaterThanOrEqual(16);
  });

  it("exits 0 in gate mode when gate file contains valid approve with nonce", async () => {
    // We need to know the nonce. Since we can't predict it, we'll read it from
    // the captured request after the POST completes.
    // Strategy: start the hook, wait for the POST, extract nonce, write gate file.
    const hookPromise = runHook("pre-tool-use.js", {
      stdin: "{}",
      env: {
        DECKY_BRIDGE_URL: bridgeUrl,
        DECKY_APPROVAL_FLOW: "gate",
        DECKY_TIMEOUT: "5",
      },
      timeoutMs: 10000,
    });

    // Wait for the POST to arrive
    const deadline = Date.now() + 3000;
    while (capture.requests.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(capture.requests.length).toBe(1);

    const nonceValue = capture.requests[0].headers["x-decky-nonce"] as string;
    expect(nonceValue).toBeDefined();

    // Write the gate file with nonce:approve
    writeFileSync(GATE_FILE, `${nonceValue}:approve`, { mode: 0o600 });

    const result = await hookPromise;
    expect(result.code).toBe(0);
  });

  it("exits 2 in gate mode when gate file has wrong nonce", async () => {
    const hookPromise = runHook("pre-tool-use.js", {
      stdin: "{}",
      env: {
        DECKY_BRIDGE_URL: bridgeUrl,
        DECKY_APPROVAL_FLOW: "gate",
        DECKY_TIMEOUT: "3",
      },
      timeoutMs: 10000,
    });

    const deadline = Date.now() + 3000;
    while (capture.requests.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Write gate file with wrong nonce
    writeFileSync(GATE_FILE, "wrong-nonce:approve", { mode: 0o600 });

    const result = await hookPromise;
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("nonce mismatch");
  });

  it("exits 2 in gate mode when gate file contains deny", async () => {
    const hookPromise = runHook("pre-tool-use.js", {
      stdin: "{}",
      env: {
        DECKY_BRIDGE_URL: bridgeUrl,
        DECKY_APPROVAL_FLOW: "gate",
        DECKY_TIMEOUT: "5",
      },
      timeoutMs: 10000,
    });

    const deadline = Date.now() + 3000;
    while (capture.requests.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const nonceValue = capture.requests[0].headers["x-decky-nonce"] as string;
    writeFileSync(GATE_FILE, `${nonceValue}:deny`, { mode: 0o600 });

    const result = await hookPromise;
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("Denied via StreamDeck");
  });
});
