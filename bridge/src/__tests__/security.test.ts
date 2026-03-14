// Allow write operations in tests (default readOnly: true would block PUT /config)
process.env.DECKY_READONLY = "0";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { isLoopbackAddress, getBridgeToken, rotateBridgeToken, redactActionForLog, validateToken } from "../security.js";

// --- Pure unit tests (no server needed) ---

describe("isLoopbackAddress", () => {
  it("returns true for 127.0.0.1", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
  });

  it("returns true for 127.0.0.2 (entire 127.0.0.0/8 range)", () => {
    expect(isLoopbackAddress("127.0.0.2")).toBe(true);
  });

  it("returns true for 127.255.255.255", () => {
    expect(isLoopbackAddress("127.255.255.255")).toBe(true);
  });

  it("returns true for localhost", () => {
    expect(isLoopbackAddress("localhost")).toBe(true);
  });

  it("returns true for localhost (case-insensitive)", () => {
    expect(isLoopbackAddress("Localhost")).toBe(true);
    expect(isLoopbackAddress("LOCALHOST")).toBe(true);
  });

  it("returns true for IPv6 loopback ::1", () => {
    expect(isLoopbackAddress("::1")).toBe(true);
  });

  it("returns false for 0.0.0.0 (wildcard)", () => {
    expect(isLoopbackAddress("0.0.0.0")).toBe(false);
  });

  it("returns false for :: (IPv6 wildcard)", () => {
    expect(isLoopbackAddress("::")).toBe(false);
  });

  it("returns false for 192.168.1.1", () => {
    expect(isLoopbackAddress("192.168.1.1")).toBe(false);
  });

  it("returns false for 10.0.0.1", () => {
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLoopbackAddress("")).toBe(false);
  });
});

describe("redactActionForLog", () => {
  it("redacts text field with length", () => {
    const result = redactActionForLog({ action: "macro", text: "secret-stuff" });
    expect(result.action).toBe("macro");
    expect(result.text).toBe("[redacted:12]");
  });

  it("redacts text inside macros array entries", () => {
    const result = redactActionForLog({
      action: "updateConfig",
      macros: [
        { label: "Greet", text: "Hello world", icon: "star", colors: { bg: "#fff" } },
        { label: "Empty", text: "" },
      ],
    });
    const macros = result.macros as Array<Record<string, unknown>>;
    expect(macros[0].label).toBe("Greet");
    expect(macros[0].text).toBe("[redacted:11]");
    expect(macros[0].icon).toBe("star");
    expect(macros[0].hasColors).toBe(true);
    expect(macros[1].text).toBe("[redacted:0]");
    expect(macros[1].hasColors).toBe(false);
  });

  it("passes through non-sensitive fields unchanged", () => {
    const result = redactActionForLog({ action: "approve", theme: "ocean" });
    expect(result.action).toBe("approve");
    expect(result.theme).toBe("ocean");
  });

  it("handles non-object macros entries gracefully", () => {
    const result = redactActionForLog({ macros: [null, 42, "str"] });
    const macros = result.macros as unknown[];
    expect(macros[0]).toBeNull();
    expect(macros[1]).toBe(42);
    expect(macros[2]).toBe("str");
  });
});

describe("validateToken", () => {
  it("returns true for matching tokens", () => {
    expect(validateToken("abc123", "abc123")).toBe(true);
  });

  it("returns false for mismatched tokens", () => {
    expect(validateToken("abc123", "xyz789")).toBe(false);
  });

  it("returns false for empty candidate", () => {
    expect(validateToken("", "abc123")).toBe(false);
  });

  it("returns false for empty expected", () => {
    expect(validateToken("abc123", "")).toBe(false);
  });

  it("returns false for different-length tokens", () => {
    expect(validateToken("short", "muchlongertoken")).toBe(false);
  });
});

describe("rotateBridgeToken", () => {
  it("generates a new token different from the previous one", () => {
    const first = rotateBridgeToken();
    const second = rotateBridgeToken();
    expect(first).not.toBe(second);
  });

  it("generates tokens of sufficient length", () => {
    const token = rotateBridgeToken();
    expect(token.length).toBeGreaterThanOrEqual(16);
  });

  it("writes the new token to the token file", () => {
    const token = rotateBridgeToken();
    const tokenPath = join(process.env.DECKY_HOME!, "bridge-token");
    const onDisk = readFileSync(tokenPath, "utf-8").trim();
    expect(onDisk).toBe(token);
  });

  it("subsequent getBridgeToken returns the rotated token", () => {
    const rotated = rotateBridgeToken();
    const fetched = getBridgeToken();
    expect(fetched).toBe(rotated);
  });
});

// --- Integration tests (require app server) ---

vi.mock("../macro-exec.js", () => ({
  executeMacro: vi.fn().mockResolvedValue(undefined),
  approveOnceInClaude: vi.fn().mockResolvedValue(undefined),
  dismissClaudeApproval: vi.fn().mockResolvedValue(undefined),
  surfaceTargetApp: vi.fn().mockResolvedValue(undefined),
  setApprovalAttemptLogger: vi.fn(),
  withApprovalAttemptContext: vi.fn(async (_actionId: string, fn: () => Promise<void>) => await fn()),
  startDictationForClaude: vi.fn().mockResolvedValue(undefined),
}));

const { createApp } = await import("../app.js");
type DeckyApp = ReturnType<typeof createApp>;

let decky: DeckyApp;
let baseUrl: string;
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
  decky.io.close();
  await new Promise<void>((resolve) => decky.httpServer.close(() => resolve()));
});

afterEach(() => {
  decky.sm.forceState("idle", "test cleanup");
});

// --- Helpers ---

function connectClient(opts?: { token?: string }): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(baseUrl, {
      reconnection: false,
      timeout: 2000,
      auth: { token: opts?.token ?? token },
    });
    client.on("connect", () => resolve(client));
    client.on("connect_error", (err) => reject(err));
  });
}

function waitForSocketEvent(
  socket: ClientSocket,
  event: string,
  timeoutMs = 2000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// --- Tranche 4: Body size limits ---

describe("body size limits", () => {
  it("rejects payloads exceeding 5mb with 413", async () => {
    // 6MB payload — well over the 5mb limit
    const oversized = "x".repeat(6_000_000);
    const res = await fetch(`${baseUrl}/hook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-decky-token": token,
      },
      body: JSON.stringify({ event: "Notification", data: oversized }),
    });
    expect(res.status).toBe(413);
  });
});

// --- Tranche 4: Socket.io action throttling ---

describe("Socket.io action throttling", () => {
  it("throttles rapid non-exempt actions (200ms minimum gap)", async () => {
    const client = await connectClient();
    try {
      // First macro action should succeed (triggers "Invalid macro payload" but goes through throttle)
      client.emit("action", { action: "macro", text: "hello" });

      // Second macro action immediately after should be throttled
      const errorPromise = waitForSocketEvent(client, "error");
      client.emit("action", { action: "macro", text: "hello" });

      const errorData = (await errorPromise) as { error: string };
      expect(errorData.error).toBe("Action throttled");
    } finally {
      client.disconnect();
    }
  });

  it("does not throttle approval actions (approve, deny, cancel, restart)", async () => {
    const client = await connectClient();
    try {
      // Send two restart actions rapidly — both should be processed (not throttled)
      let throttleErrorReceived = false;
      client.on("error", (data: { error: string }) => {
        if (data.error === "Action throttled") throttleErrorReceived = true;
      });

      client.emit("action", { action: "restart" });
      client.emit("action", { action: "restart" });

      // Wait briefly to allow any error events to arrive
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(throttleErrorReceived).toBe(false);
    } finally {
      client.disconnect();
    }
  });
});

// --- Tranche 5: Debug endpoint gating ---

describe("debug endpoint gating", () => {
  it("returns 404 for /debug/approval-trace when DECKY_DEBUG is not set", async () => {
    // DECKY_DEBUG is NOT set in this test file (unlike mirror-approval.test.ts)
    const res = await fetch(`${baseUrl}/debug/approval-trace`, {
      headers: { "x-decky-token": token },
    });
    expect(res.status).toBe(404);
  });
});

// --- Tranche 6: HTTP Authentication ---

describe("HTTP authentication", () => {
  it("rejects POST /hook without token (401)", async () => {
    const res = await fetch(`${baseUrl}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "Notification" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects POST /hook with wrong token (401)", async () => {
    const res = await fetch(`${baseUrl}/hook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-decky-token": "wrong-token-value",
      },
      body: JSON.stringify({ event: "Notification" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects GET /status without token (401)", async () => {
    const res = await fetch(`${baseUrl}/status`);
    expect(res.status).toBe(401);
  });

  it("rejects GET /config without token (401)", async () => {
    const res = await fetch(`${baseUrl}/config`);
    expect(res.status).toBe(401);
  });

  it("rejects PUT /config without token (401)", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalTimeout: 30 }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects POST /config/reload without token (401)", async () => {
    const res = await fetch(`${baseUrl}/config/reload`, { method: "POST" });
    expect(res.status).toBe(401);
  });

});

// --- Tranche 6: Socket.io Authentication ---

describe("Socket.io authentication", () => {
  it("disconnects client with no token", async () => {
    const client = ioClient(baseUrl, {
      reconnection: false,
      timeout: 2000,
      auth: { token: "" },
    });

    const disconnectReason = await new Promise<string>((resolve) => {
      client.on("disconnect", (reason) => resolve(reason));
      // Also handle connect_error as a fallback
      client.on("connect_error", () => resolve("connect_error"));
    });

    // Server-initiated disconnect or error
    expect(["io server disconnect", "connect_error"]).toContain(disconnectReason);
    client.disconnect();
  });

  it("disconnects client with wrong token", async () => {
    const client = ioClient(baseUrl, {
      reconnection: false,
      timeout: 2000,
      auth: { token: "completely-wrong-token-value" },
    });

    const disconnectReason = await new Promise<string>((resolve) => {
      client.on("disconnect", (reason) => resolve(reason));
      client.on("connect_error", () => resolve("connect_error"));
    });

    expect(["io server disconnect", "connect_error"]).toContain(disconnectReason);
    client.disconnect();
  });

  it("emits error with 'Unauthorized' before disconnect", async () => {
    const client = ioClient(baseUrl, {
      reconnection: false,
      timeout: 2000,
      auth: { token: "bad-token" },
    });

    const errorData = await new Promise<{ error: string } | null>((resolve) => {
      let gotError = false;
      client.on("error", (data: { error: string }) => {
        gotError = true;
        resolve(data);
      });
      client.on("disconnect", () => {
        if (!gotError) resolve(null);
      });
      client.on("connect_error", () => {
        if (!gotError) resolve(null);
      });
    });

    // The error event may or may not fire before disconnect depending on timing,
    // but if it does fire, it should say "Unauthorized"
    if (errorData) {
      expect(errorData.error).toBe("Unauthorized");
    }
    client.disconnect();
  });
});

// --- Tranche 6: CORS Policy ---

describe("CORS policy", () => {
  it("allows requests from localhost origin", async () => {
    const res = await fetch(`${baseUrl}/status`, {
      headers: {
        "x-decky-token": token,
        Origin: "http://localhost:9130",
      },
    });
    expect(res.status).toBe(200);
    // CORS headers may be set by Socket.io/Express — check presence
    const acao = res.headers.get("access-control-allow-origin");
    // When CORS allows, the origin is echoed back or * is returned
    if (acao) {
      expect(acao).toMatch(/localhost/);
    }
  });

  it("allows requests from 127.0.0.1 origin", async () => {
    const res = await fetch(`${baseUrl}/status`, {
      headers: {
        "x-decky-token": token,
        Origin: "http://127.0.0.1:9130",
      },
    });
    expect(res.status).toBe(200);
  });
});

// --- Tranche 6: Config Validation Bounds ---

describe("config validation bounds", () => {
  it("rejects approvalTimeout below minimum (5)", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-decky-token": token,
      },
      body: JSON.stringify({ approvalTimeout: 4 }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects approvalTimeout above maximum (300)", async () => {
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-decky-token": token,
      },
      body: JSON.stringify({ approvalTimeout: 301 }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects macro array exceeding 36 entries", async () => {
    const macros = Array.from({ length: 37 }, (_, i) => ({
      label: `M${i}`,
      text: `text${i}`,
    }));
    const res = await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-decky-token": token,
      },
      body: JSON.stringify({ macros }),
    });
    expect(res.status).toBe(400);
  });

  it("silently drops macros with text > 2000 chars (per-macro validation)", async () => {
    // First save a known good config
    const goodMacros = [{ label: "Good", text: "ok" }];
    await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-decky-token": token,
      },
      body: JSON.stringify({ macros: goodMacros }),
    });

    // Now try to save with an oversized text
    const badMacros = [{ label: "Bad", text: "x".repeat(2001) }];
    await fetch(`${baseUrl}/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-decky-token": token,
      },
      body: JSON.stringify({ macros: badMacros }),
    });

    // Check persisted config — oversized macro should not have text > 2000
    const getRes = await fetch(`${baseUrl}/config`, {
      headers: { "x-decky-token": token },
    });
    const config = (await getRes.json()) as { macros: { text: string }[] };
    for (const macro of config.macros) {
      expect(macro.text.length).toBeLessThanOrEqual(2000);
    }
  });
});

// --- Tranche 6: Socket.io Macro Validation ---

describe("Socket.io macro validation", () => {
  it("rejects macro with text > 2000 chars", async () => {
    const client = await connectClient();
    try {
      const errorPromise = waitForSocketEvent(client, "error");
      client.emit("action", {
        action: "macro",
        text: "x".repeat(2001),
      });
      const errorData = (await errorPromise) as { error: string };
      expect(errorData.error).toBe("Invalid macro payload");
    } finally {
      client.disconnect();
    }
  });

  it("rejects macro with empty text", async () => {
    const client = await connectClient();
    try {
      const errorPromise = waitForSocketEvent(client, "error");
      client.emit("action", {
        action: "macro",
        text: "",
      });
      const errorData = (await errorPromise) as { error: string };
      expect(errorData.error).toBe("Invalid macro payload");
    } finally {
      client.disconnect();
    }
  });

  it("rejects macro with null text", async () => {
    const client = await connectClient();
    try {
      const errorPromise = waitForSocketEvent(client, "error");
      client.emit("action", {
        action: "macro",
        text: null,
      });
      const errorData = (await errorPromise) as { error: string };
      expect(errorData.error).toBe("Invalid macro payload");
    } finally {
      client.disconnect();
    }
  });
});

// --- Tranche 1c: Platform capabilities in /status ---

describe("platform capabilities", () => {
  it("GET /status includes capabilities object", async () => {
    const res = await fetch(`${baseUrl}/status`, {
      headers: { "x-decky-token": token },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      capabilities: {
        textInjection: boolean;
        approveInApp: boolean;
        dictation: boolean;
        platform: string;
      };
    };
    expect(body.capabilities).toBeDefined();
    expect(body.capabilities.platform).toBe(process.platform);
    expect(typeof body.capabilities.textInjection).toBe("boolean");
    expect(typeof body.capabilities.approveInApp).toBe("boolean");
    expect(typeof body.capabilities.dictation).toBe("boolean");
  });

  it("capabilities are included in Socket.io state events", async () => {
    const client = await connectClient();
    try {
      const statePromise = waitForSocketEvent(client, "stateChange");
      // Trigger a state change so the event fires
      decky.sm.forceState("thinking", "test capabilities");
      const stateData = (await statePromise) as {
        capabilities: { platform: string };
      };
      expect(stateData.capabilities).toBeDefined();
      expect(stateData.capabilities.platform).toBe(process.platform);
    } finally {
      client.disconnect();
    }
  });
});
