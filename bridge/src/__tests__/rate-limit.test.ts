/**
 * Tests for RateLimitStore and /rate-limit HTTP endpoints.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { RateLimitStore } from "../rate-limit.js";
import { getBridgeToken } from "../security.js";

// --- Unit tests for RateLimitStore ---

describe("RateLimitStore", () => {
  it("getSummary returns zero totals when empty", () => {
    const store = new RateLimitStore();
    const summary = store.getSummary();
    expect(summary.totalTokens5h).toBe(0);
    expect(summary.percentUsed).toBeNull();
    expect(summary.resetAt).toBeNull();
  });

  it("accumulates input and output tokens", () => {
    const store = new RateLimitStore();
    const now = Date.now();
    store.addUsage(1000, 500, now);
    store.addUsage(2000, 300, now + 1000);
    const summary = store.getSummary(now + 2000);
    expect(summary.totalTokens5h).toBe(3800);
  });

  it("prunes entries older than 5 hours", () => {
    const store = new RateLimitStore();
    const old = Date.now() - 5 * 60 * 60 * 1000 - 1000; // older than 5h
    const recent = Date.now();
    store.addUsage(10000, 5000, old);
    store.addUsage(100, 50, recent);
    const summary = store.getSummary(recent + 1);
    // Only the recent entry should count
    expect(summary.totalTokens5h).toBe(150);
    expect(summary.resetAt).toBeGreaterThan(recent);
  });

  it("resetAt is the oldest entry's timestamp + 5h", () => {
    const store = new RateLimitStore();
    const now = Date.now();
    store.addUsage(100, 50, now);
    const summary = store.getSummary(now);
    expect(summary.resetAt).toBe(now + 5 * 60 * 60 * 1000);
  });

  it("percentUsed is null when no limit is set", () => {
    const store = new RateLimitStore();
    store.addUsage(1000, 500);
    expect(store.getSummary().percentUsed).toBeNull();
  });

  it("percentUsed is calculated correctly when limit is set", () => {
    const store = new RateLimitStore();
    store.setLimit(10000);
    store.addUsage(5000, 0);
    const summary = store.getSummary();
    expect(summary.percentUsed).toBeCloseTo(50);
  });

  it("percentUsed is capped at 100", () => {
    const store = new RateLimitStore();
    store.setLimit(100);
    store.addUsage(50000, 50000);
    expect(store.getSummary().percentUsed).toBe(100);
  });

  it("negative token values are clamped to zero", () => {
    const store = new RateLimitStore();
    store.addUsage(-100, -200);
    expect(store.getSummary().totalTokens5h).toBe(0);
  });

  it("entryCount reflects current window size", () => {
    const store = new RateLimitStore();
    expect(store.entryCount).toBe(0);
    store.addUsage(100, 50);
    store.addUsage(200, 100);
    expect(store.entryCount).toBe(2);
    store.clear();
    expect(store.entryCount).toBe(0);
  });
});

// --- HTTP endpoint tests ---

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

async function postHook(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-decky-token": token },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function getRateLimit() {
  const res = await fetch(`${baseUrl}/rate-limit`, {
    headers: { "x-decky-token": token },
  });
  return { status: res.status, data: await res.json() };
}

async function postRateLimit(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/rate-limit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-decky-token": token },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

describe("/rate-limit endpoints", () => {
  it("GET /rate-limit returns empty summary initially", async () => {
    const { status, data } = await getRateLimit();
    expect(status).toBe(200);
    expect(data.totalTokens5h).toBe(0);
    expect(data.percentUsed).toBeNull();
    expect(data.resetAt).toBeNull();
  });

  it("POST /rate-limit accepts inputTokens and outputTokens", async () => {
    const { status, data } = await postRateLimit({ inputTokens: 1000, outputTokens: 500 });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.totalTokens5h).toBe(1500);
  });

  it("POST /rate-limit with limitTokens5h returns non-null percentUsed", async () => {
    const { data } = await postRateLimit({ inputTokens: 100, outputTokens: 0, limitTokens5h: 100000 });
    expect(data.percentUsed).not.toBeNull();
    expect(typeof data.percentUsed).toBe("number");
    expect(data.percentUsed).toBeGreaterThan(0);
  });

  it("POST /rate-limit with zero tokens returns 400", async () => {
    const { status } = await postRateLimit({ inputTokens: 0, outputTokens: 0 });
    expect(status).toBe(400);
  });

  it("Stop hook with usage accumulates tokens", async () => {
    const { data } = await postHook({
      event: "Stop",
      usage: { input_tokens: 2000, output_tokens: 800 },
    });
    expect(data.state.rateLimit).toBeDefined();
    expect(data.state.rateLimit.totalTokens5h).toBeGreaterThanOrEqual(2800);
  });

  it("Stop hook without usage does not change rate limit", async () => {
    const { data: before } = await getRateLimit();
    await postHook({ event: "Stop" });
    const { data: after } = await getRateLimit();
    expect(after.totalTokens5h).toBe(before.totalTokens5h);
  });

  it("statePayload includes rateLimit field", async () => {
    const res = await fetch(`${baseUrl}/status`, {
      headers: { "x-decky-token": token },
    });
    const data = await res.json();
    expect(data).toHaveProperty("rateLimit");
    expect(typeof data.rateLimit.totalTokens5h).toBe("number");
  });
});
