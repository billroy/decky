/**
 * BridgeClient tests — verifies Socket.io connection to the bridge server,
 * state change reception, and action emission.
 *
 * Spins up a real bridge server instance on a random port for integration testing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { BridgeClient, type ConnectionStatus, type StateSnapshot } from "../bridge-client.js";

let decky: { io: { close: () => void }; httpServer: { listen: (port: number, cb: () => void) => void; address: () => unknown; close: (cb: () => void) => void } };
let port: number;
let bridgeUrl: string;
let token = "";

const TEST_DECKY_HOME = join(process.cwd(), ".decky-test-plugin");

beforeAll(async () => {
  rmSync(TEST_DECKY_HOME, { recursive: true, force: true });
  process.env.DECKY_HOME = TEST_DECKY_HOME;
  const [{ createApp }, { getBridgeToken }] = await Promise.all([
    import("../../../bridge/src/app.js"),
    import("../../../bridge/src/security.js"),
  ]);
  token = getBridgeToken();
  decky = createApp();
  await new Promise<void>((resolve) => {
    decky.httpServer.listen(0, () => resolve());
  });
  const addr = decky.httpServer.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
  bridgeUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  decky.io.close();
  await new Promise<void>((resolve) => decky.httpServer.close(() => resolve()));
  rmSync(TEST_DECKY_HOME, { recursive: true, force: true });
});

function waitForConnection(
  client: BridgeClient,
  predicate: (s: ConnectionStatus) => boolean,
  timeoutMs = 3000,
): Promise<ConnectionStatus> {
  return new Promise((resolve, reject) => {
    // Check current state first
    if (predicate(client.getConnectionStatus())) {
      return resolve(client.getConnectionStatus());
    }
    const timer = setTimeout(() => { unsub(); reject(new Error("waitForConnection timed out")); }, timeoutMs);
    const unsub = client.onConnectionChange((s) => {
      if (predicate(s)) {
        clearTimeout(timer);
        unsub();
        resolve(s);
      }
    });
  });
}

function waitForState(
  client: BridgeClient,
  predicate: (s: StateSnapshot) => boolean,
  timeoutMs = 3000,
): Promise<StateSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error("waitForState timed out")); }, timeoutMs);
    const unsub = client.onStateChange((s) => {
      if (predicate(s)) {
        clearTimeout(timer);
        unsub();
        resolve(s);
      }
    });
  });
}

function waitForBridgeEvent(
  client: BridgeClient,
  eventName: string,
  timeoutMs = 3000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error("waitForBridgeEvent timed out")); }, timeoutMs);
    const unsub = client.onBridgeEvent((event, payload) => {
      if (event === eventName) {
        clearTimeout(timer);
        unsub();
        resolve(payload);
      }
    });
  });
}

async function postHook(event: string, tool?: string) {
  await fetch(`${bridgeUrl}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-decky-token": token },
    body: JSON.stringify({ event, tool }),
  });
}

async function resetBridge() {
  await postHook("Stop");
}

describe("BridgeClient", () => {
  it("connects to the bridge and receives initial state", async () => {
    const client = new BridgeClient(bridgeUrl);

    const statePromise = waitForState(client, () => true);
    client.connect();
    await waitForConnection(client, (s) => s === "connected");

    expect(client.getConnectionStatus()).toBe("connected");

    const snapshot = await statePromise;
    expect(snapshot).toHaveProperty("state");
    expect(client.getLastSnapshot()).toEqual(snapshot);

    client.disconnect();
    expect(client.getConnectionStatus()).toBe("disconnected");
  });

  it("receives stateChange events when bridge state changes", async () => {
    const client = new BridgeClient(bridgeUrl);

    // Set up listeners BEFORE connect to avoid missing the initial stateChange
    const initialState = waitForState(client, () => true);
    client.connect();
    await waitForConnection(client, (s) => s === "connected");
    await initialState;

    // Now trigger a state change via the bridge HTTP API
    const approvalPromise = waitForState(client, (s) => s.state === "awaiting-approval");
    await postHook("PreToolUse", "Bash");
    const snap = await approvalPromise;

    expect(snap.state).toBe("awaiting-approval");
    expect(snap.tool).toBe("Bash");

    await resetBridge();
    client.disconnect();
  });

  it("sends actions to the bridge", async () => {
    const client = new BridgeClient(bridgeUrl);

    // Set up listeners BEFORE connect
    const initialState = waitForState(client, () => true);
    client.connect();
    await waitForConnection(client, (s) => s === "connected");
    await initialState;

    // Put bridge into awaiting-approval
    const approvalPromise = waitForState(client, (s) => s.state === "awaiting-approval");
    await postHook("PreToolUse", "Read");
    await approvalPromise;

    // Send approve action
    const executingPromise = waitForState(client, (s) => s.state === "tool-executing");
    client.sendAction("approve");
    const snap = await executingPromise;

    expect(snap.state).toBe("tool-executing");

    await resetBridge();
    client.disconnect();
  });

  it("reports disconnected when bridge is unreachable", async () => {
    const client = new BridgeClient("http://localhost:1");
    const listener = vi.fn();
    client.onConnectionChange(listener);

    client.connect();
    await new Promise((r) => setTimeout(r, 1500));

    expect(client.getConnectionStatus()).toBe("disconnected");
    client.disconnect();
  });

  it("receives updateConfigAck bridge events", async () => {
    const client = new BridgeClient(bridgeUrl);
    client.connect();
    await waitForConnection(client, (s) => s === "connected");

    const onConfig = vi.fn();
    client.onConfigChange(onConfig);

    const eventPromise = waitForBridgeEvent(client, "updateConfigAck");
    client.sendAction("updateConfig", {
      requestId: "bridge-client-ack",
      macros: [{ label: "A", text: "B" }],
    });

    const payload = await eventPromise as { requestId?: string };
    expect(payload.requestId).toBe("bridge-client-ack");
    expect(client.getLastConfig()?.macros[0]?.label).toBe("A");
    expect(onConfig).toHaveBeenCalled();
    client.disconnect();
  });
});
