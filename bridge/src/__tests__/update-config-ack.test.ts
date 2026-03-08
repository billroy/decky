import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createApp, type DeckyApp } from "../app.js";
import { getBridgeToken } from "../security.js";

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

function connectClient(): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const client = ioClient(baseUrl, { forceNew: true, auth: { token } });
    client.on("connect", () => resolve(client));
  });
}

function waitForEvent<T>(sock: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    sock.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("socket updateConfig acknowledgements", () => {
  it("emits updateConfigAck with matching requestId", async () => {
    const sock = await connectClient();
    const requestId = "req-ack-1";
    const ackPromise = waitForEvent<{
      requestId: string;
      macroCount: number;
      config?: { macros?: Array<{ label?: string; text?: string }> };
    }>(sock, "updateConfigAck");

    sock.emit("action", {
      action: "updateConfig",
      requestId,
      macros: [{ label: "Ack Test", text: "ok" }],
    });

    const ack = await ackPromise;
    expect(ack.requestId).toBe(requestId);
    expect(ack.macroCount).toBe(1);
    expect(ack.config?.macros?.[0]?.label).toBe("Ack Test");
    expect(ack.config?.macros?.[0]?.text).toBe("ok");
    sock.disconnect();
  });

  it("emits updateConfigError with matching requestId when validation fails", async () => {
    const sock = await connectClient();
    const requestId = "req-err-1";
    const errPromise = waitForEvent<{ requestId: string; error: string }>(sock, "updateConfigError");

    sock.emit("action", {
      action: "updateConfig",
      requestId,
      approvalTimeout: 0,
    });

    const err = await errPromise;
    expect(err.requestId).toBe(requestId);
    expect(err.error).toMatch(/approvalTimeout/i);
    sock.disconnect();
  });

  it("keeps generated themeSeed in range for random/rainbow apply", async () => {
    const sock = await connectClient();
    const requestId = "req-theme-seed-range";
    const ackPromise = waitForEvent<{ requestId: string }>(sock, "updateConfigAck");
    const cfgPromise = waitForEvent<{ themeSeed?: number; theme?: string }>(sock, "configUpdate");

    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => 0xffffffff;
    Math.random = () => 0;
    try {
      sock.emit("action", {
        action: "updateConfig",
        requestId,
        theme: "random",
        themeApplyMode: "keep",
      });
      const ack = await ackPromise;
      const cfg = await cfgPromise;
      expect(ack.requestId).toBe(requestId);
      expect(cfg.theme).toBe("random");
      expect(typeof cfg.themeSeed).toBe("number");
      expect(cfg.themeSeed!).toBeGreaterThanOrEqual(0);
      expect(cfg.themeSeed!).toBeLessThanOrEqual(0x7fffffff);
    } finally {
      Date.now = originalNow;
      Math.random = originalRandom;
      sock.disconnect();
    }
  });
});
