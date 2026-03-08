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

  triggerConfig(config: any) {
    this.config = config;
    for (const cb of this.configListeners) cb(config);
  }
}

function makeKeyAction(id = "action-1") {
  return {
    id,
    device: { size: { columns: 5 } },
    setImage: vi.fn().mockResolvedValue(undefined),
    setTitle: vi.fn().mockResolvedValue(undefined),
    isKey: () => true,
  };
}

function decodeImageData(imageData: string): string {
  const prefix = "data:image/svg+xml,";
  return decodeURIComponent(imageData.startsWith(prefix) ? imageData.slice(prefix.length) : imageData);
}

function baseConfig(): any {
  return {
    macros: [{ label: "Yes", text: "Yes", targetApp: "codex" }],
    approvalTimeout: 30,
    theme: "light",
    themeSeed: 1,
    defaultTargetApp: "claude",
    showTargetBadge: false,
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe("SlotAction render path", () => {
  it("re-renders key with target badge when badge enabled", async () => {
    const { SlotAction, setSlotClient, resetSlots } = await import("../actions/slot.js");
    resetSlots();

    const bridge = new FakeBridge(baseConfig());
    setSlotClient(bridge as any);

    const action = makeKeyAction();
    const slot = new SlotAction();
    (slot as any).actions = [action];

    await slot.onWillAppear({
      action,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 0 } },
    } as any);

    const beforeSvg = decodeImageData(action.setImage.mock.calls.at(-1)[0]);
    expect(beforeSvg).not.toContain("CDX");

    bridge.triggerConfig({ ...bridge.config, showTargetBadge: true });
    await new Promise((r) => setTimeout(r, 0));

    const afterSvg = decodeImageData(action.setImage.mock.calls.at(-1)[0]);
    expect(afterSvg).toContain("CDX");
  });

  it("re-renders random theme when seed changes", async () => {
    const { SlotAction, setSlotClient, resetSlots } = await import("../actions/slot.js");
    resetSlots();

    const bridge = new FakeBridge({ ...baseConfig(), theme: "random", themeSeed: 10 });
    setSlotClient(bridge as any);

    const action = makeKeyAction();
    const slot = new SlotAction();
    (slot as any).actions = [action];

    await slot.onWillAppear({
      action,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 0 } },
    } as any);

    const svgA = decodeImageData(action.setImage.mock.calls.at(-1)[0]);

    bridge.triggerConfig({ ...bridge.config, themeSeed: 11 });
    await new Promise((r) => setTimeout(r, 0));

    const svgB = decodeImageData(action.setImage.mock.calls.at(-1)[0]);
    expect(svgB).not.toEqual(svgA);
  });

  it("re-renders random theme even when page/macro overrides exist", async () => {
    const { SlotAction, setSlotClient, resetSlots } = await import("../actions/slot.js");
    resetSlots();

    const bridge = new FakeBridge({
      ...baseConfig(),
      theme: "random",
      themeSeed: 200,
      colors: { bg: "#000000", text: "#22c55e", icon: "#22c55e" },
      macros: [
        {
          label: "Yes",
          text: "yes",
          targetApp: "codex",
          colors: { bg: "#000000", text: "#22c55e", icon: "#22c55e" },
        },
      ],
    });
    setSlotClient(bridge as any);

    const action = makeKeyAction();
    const slot = new SlotAction();
    (slot as any).actions = [action];

    await slot.onWillAppear({
      action,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 0 } },
    } as any);

    const svgA = decodeImageData(action.setImage.mock.calls.at(-1)[0]);
    bridge.triggerConfig({ ...bridge.config, themeSeed: 201 });
    await new Promise((r) => setTimeout(r, 0));
    const svgB = decodeImageData(action.setImage.mock.calls.at(-1)[0]);

    expect(svgB).not.toEqual(svgA);
  });

  it("re-renders badge when selected macro target changes to codex", async () => {
    const { SlotAction, setSlotClient, resetSlots } = await import("../actions/slot.js");
    resetSlots();

    const bridge = new FakeBridge({
      ...baseConfig(),
      macros: [{ label: "Yes", text: "Yes", targetApp: "claude" }],
      showTargetBadge: true,
    });
    setSlotClient(bridge as any);

    const action = makeKeyAction();
    const slot = new SlotAction();
    (slot as any).actions = [action];

    await slot.onWillAppear({
      action,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 0 } },
    } as any);
    const beforeSvg = decodeImageData(action.setImage.mock.calls.at(-1)[0]);
    expect(beforeSvg).not.toContain("CDX");

    bridge.triggerConfig({
      ...bridge.config,
      macros: [{ label: "Yes", text: "Yes", targetApp: "codex" }],
    });
    await new Promise((r) => setTimeout(r, 0));

    const afterSvg = decodeImageData(action.setImage.mock.calls.at(-1)[0]);
    expect(afterSvg).toContain("CDX");
  });

  it("re-renders rainbow theme when seed changes", async () => {
    const { SlotAction, setSlotClient, resetSlots } = await import("../actions/slot.js");
    resetSlots();

    const bridge = new FakeBridge({
      ...baseConfig(),
      macros: [
        { label: "One", text: "one", targetApp: "codex" },
        { label: "Two", text: "two", targetApp: "codex" },
        { label: "Three", text: "three", targetApp: "codex" },
      ],
      theme: "rainbow",
      themeSeed: 100,
    });
    setSlotClient(bridge as any);

    const action = makeKeyAction("action-1");
    const action2 = makeKeyAction("action-2");
    const action3 = makeKeyAction("action-3");
    const slot = new SlotAction();
    (slot as any).actions = [action, action2, action3];

    await slot.onWillAppear({
      action,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 0 } },
    } as any);
    await slot.onWillAppear({
      action: action2,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 1 } },
    } as any);
    await slot.onWillAppear({
      action: action3,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 2 } },
    } as any);

    const before = [
      decodeImageData(action.setImage.mock.calls.at(-1)[0]),
      decodeImageData(action2.setImage.mock.calls.at(-1)[0]),
      decodeImageData(action3.setImage.mock.calls.at(-1)[0]),
    ];

    bridge.triggerConfig({ ...bridge.config, themeSeed: 101 });
    await new Promise((r) => setTimeout(r, 0));

    const after = [
      decodeImageData(action.setImage.mock.calls.at(-1)[0]),
      decodeImageData(action2.setImage.mock.calls.at(-1)[0]),
      decodeImageData(action3.setImage.mock.calls.at(-1)[0]),
    ];
    expect(after.some((svg, i) => svg !== before[i])).toBe(true);
  });
});
