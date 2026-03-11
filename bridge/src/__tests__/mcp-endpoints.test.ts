/**
 * Tests for bridge endpoints added for MCP server:
 * - GET /logs (log buffer endpoint)
 * - GET /status includes uptimeSeconds and deck fields
 * - slotHeartbeat Socket.io event stores deck layout
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { getBridgeToken } from "../security.js";

vi.mock("../macro-exec.js", () => ({
  executeMacro: vi.fn().mockResolvedValue(undefined),
  approveOnceInClaude: vi.fn().mockResolvedValue(undefined),
  dismissClaudeApproval: vi.fn().mockResolvedValue(undefined),
  approveInTargetApp: vi.fn().mockResolvedValue(undefined),
  dismissApprovalInTargetApp: vi.fn().mockResolvedValue(undefined),
  surfaceTargetApp: vi.fn().mockResolvedValue(undefined),
  setApprovalAttemptLogger: vi.fn(),
  withApprovalAttemptContext: vi.fn(async (_id: string, fn: () => Promise<void>) => fn()),
  startDictationForClaude: vi.fn().mockResolvedValue(undefined),
}));

const { createApp } = await import("../app.js");
type DeckyApp = ReturnType<typeof createApp>;

let decky: DeckyApp;
let baseUrl: string;
let client: ClientSocket;
const token = getBridgeToken();

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: { "x-decky-token": token },
  });
}

beforeAll(async () => {
  decky = createApp();
  await new Promise<void>((resolve) => {
    decky.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = decky.httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  client = ioClient(baseUrl, {
    auth: { token },
    transports: ["websocket"],
  });
  await new Promise<void>((resolve) => client.on("connect", resolve));
});

afterAll(async () => {
  client?.disconnect();
  decky.io.close();
  await new Promise<void>((resolve) => decky.httpServer.close(() => resolve()));
  decky.restoreConsole();
});

describe("GET /status", () => {
  it("includes uptimeSeconds field", async () => {
    const res = await get("/status");
    const data = await res.json() as Record<string, unknown>;
    expect(typeof data.uptimeSeconds).toBe("number");
    expect(data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("deck is null before any slotHeartbeat", async () => {
    const res = await get("/status");
    const data = await res.json() as Record<string, unknown>;
    expect(data.deck).toBeNull();
  });
});

describe("slotHeartbeat Socket.io event", () => {
  it("stores deck layout and exposes it in GET /status", async () => {
    const heartbeat = {
      deviceId: "test-device-1",
      model: "20",
      rows: 3,
      cols: 5,
      buttonCount: 15,
      activeSlots: [
        { row: 0, col: 0, index: 0, label: "Push" },
        { row: 0, col: 1, index: 1, label: "Status" },
      ],
    };
    client.emit("slotHeartbeat", heartbeat);

    // Wait for the bridge to process the event
    await new Promise((resolve) => setTimeout(resolve, 100));

    const res = await get("/status");
    const data = await res.json() as Record<string, unknown>;
    const deck = data.deck as Record<string, unknown> | null;
    expect(deck).not.toBeNull();
    expect(deck?.deviceId).toBe("test-device-1");
    expect(deck?.rows).toBe(3);
    expect(deck?.cols).toBe(5);
    expect(Array.isArray(deck?.activeSlots)).toBe(true);
  });
});

describe("GET /logs", () => {
  it("returns lines array", async () => {
    const res = await get("/logs");
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(Array.isArray(data.lines)).toBe(true);
  });

  it("respects the lines limit parameter", async () => {
    const res = await get("/logs?lines=5");
    const data = await res.json() as { lines: string[] };
    expect(data.lines.length).toBeLessThanOrEqual(5);
  });

  it("level=error filters to error lines only", async () => {
    // Trigger a few console.error calls so the buffer has errors
    console.error("[test] error line 1");
    console.error("[test] error line 2");

    const res = await get("/logs?level=error&lines=100");
    const data = await res.json() as { lines: string[] };
    // All returned lines should be error level
    for (const line of data.lines) {
      expect(line).toContain("[error]");
    }
  });

  it("level=all returns all levels", async () => {
    console.log("[test] info line");
    console.warn("[test] warn line");

    const res = await get("/logs?level=all&lines=100");
    const data = await res.json() as { lines: string[] };
    expect(data.lines.length).toBeGreaterThan(0);
  });

  it("requires auth token", async () => {
    const res = await fetch(`${baseUrl}/logs`);
    expect(res.status).toBe(401);
  });
});
