import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@elgato/streamdeck", async () => {
  class MockSingletonAction {
    actions: unknown[] = [];
  }
  const mockDefault = {
    ui: {
      action: {},
      sendToPropertyInspector: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    __esModule: true,
    default: mockDefault,
    action: () => (target: unknown) => target,
    SingletonAction: MockSingletonAction,
  };
});

type Listener<T extends unknown[]> = (...args: T) => void;

class FakeBridge {
  connection: "connected" | "disconnected" | "connecting" = "connected";
  snapshot = {
    state: "idle",
    previousState: null,
    tool: null,
    lastEvent: null,
    timestamp: Date.now(),
  };
  config: any;

  connectionListeners: Array<Listener<["connected" | "disconnected" | "connecting"]>> = [];
  stateListeners: Array<Listener<[any]>> = [];
  configListeners: Array<Listener<[any]>> = [];
  bridgeEventListeners: Array<Listener<[string, unknown]>> = [];

  constructor(config: any) {
    this.config = config;
  }

  getConnectionStatus() {
    return this.connection;
  }

  getLastSnapshot() {
    return this.snapshot;
  }

  getLastConfig() {
    return this.config;
  }

  onConnectionChange(fn: Listener<["connected" | "disconnected" | "connecting"]>) {
    this.connectionListeners.push(fn);
    return () => {
      this.connectionListeners = this.connectionListeners.filter((l) => l !== fn);
    };
  }

  onStateChange(fn: Listener<[any]>) {
    this.stateListeners.push(fn);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== fn);
    };
  }

  onConfigChange(fn: Listener<[any]>) {
    this.configListeners.push(fn);
    return () => {
      this.configListeners = this.configListeners.filter((l) => l !== fn);
    };
  }

  onBridgeEvent(fn: Listener<[string, unknown]>) {
    this.bridgeEventListeners.push(fn);
    return () => {
      this.bridgeEventListeners = this.bridgeEventListeners.filter((l) => l !== fn);
    };
  }

  sendAction = vi.fn();
  sendEvent = vi.fn();

  triggerConfig(config: any) {
    this.config = config;
    for (const cb of this.configListeners) cb(config);
  }
}

function makeKeyAction(id: string) {
  return {
    id,
    device: { size: { columns: 5 } },
    setImage: vi.fn().mockResolvedValue(undefined),
    setTitle: vi.fn().mockResolvedValue(undefined),
    setSettings: vi.fn().mockResolvedValue(undefined),
    isKey: () => true,
  };
}

function baseConfig(): any {
  return {
    macros: [
      { label: "One", text: "One", targetApp: "claude" },
      { label: "Two", text: "Two", targetApp: "claude" },
    ],
    approvalTimeout: 30,
    theme: "light",
    themeSeed: 1,
    defaultTargetApp: "claude",
    showTargetBadge: false,
    colors: { bg: "#ffffff", text: "#1e293b", icon: "#64748b" },
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe("oracle: slot render assignment integrity", () => {
  it("does not render unassigned actions during config-driven render", async () => {
    const slotMod = await import("../src/actions/slot.js");
    const SlotAction = (slotMod as any).SlotAction;
    const setSlotClient = (slotMod as any).setSlotClient;
    const resetSlots = (slotMod as any).resetSlots;

    if (!SlotAction || !setSlotClient || !resetSlots) {
      throw new Error("slot exports unavailable");
    }

    resetSlots();

    const bridge = new FakeBridge(baseConfig());
    setSlotClient(bridge as any);

    const a1 = makeKeyAction("a-1");
    const a2 = makeKeyAction("a-2");

    const slot = new SlotAction();
    (slot as any).actions = [a1, a2];

    await slot.onWillAppear({
      action: a1,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 0 } },
    } as any);

    bridge.triggerConfig({
      ...bridge.config,
      colors: { bg: "#ef4444", text: "#ffffff", icon: "#ffffff" },
    });
    await new Promise((r) => setTimeout(r, 0));

    // Regression signature: unassigned action a2 should not be touched.
    expect(a2.setImage.mock.calls.length).toBe(0);
  });
});
