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

  triggerConfigFirstOnly(config: any) {
    this.config = config;
    const first = this.configListeners[0];
    if (first) first(config);
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

function latestSvg(action: ReturnType<typeof makeKeyAction>): string {
  const calls = action.setImage.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return decodeImageData(calls[calls.length - 1][0]);
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

    const beforeSvg = latestSvg(action);
    expect(beforeSvg).not.toContain("CDX");

    bridge.triggerConfig({ ...bridge.config, showTargetBadge: true });
    await new Promise((r) => setTimeout(r, 0));

    const afterSvg = latestSvg(action);
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

    const svgA = latestSvg(action);

    bridge.triggerConfig({ ...bridge.config, themeSeed: 11 });
    await new Promise((r) => setTimeout(r, 0));

    const svgB = latestSvg(action);
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

    const svgA = latestSvg(action);
    bridge.triggerConfig({ ...bridge.config, themeSeed: 201 });
    await new Promise((r) => setTimeout(r, 0));
    const svgB = latestSvg(action);

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
    const beforeSvg = latestSvg(action);
    expect(beforeSvg).not.toContain("CDX");

    bridge.triggerConfig({
      ...bridge.config,
      macros: [{ label: "Yes", text: "Yes", targetApp: "codex" }],
    });
    await new Promise((r) => setTimeout(r, 0));

    const afterSvg = latestSvg(action);
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

    const before = [latestSvg(action), latestSvg(action2), latestSvg(action3)];

    bridge.triggerConfig({ ...bridge.config, themeSeed: 101 });
    await new Promise((r) => setTimeout(r, 0));

    const after = [latestSvg(action), latestSvg(action2), latestSvg(action3)];
    expect(after.some((svg, i) => svg !== before[i])).toBe(true);
  });

  it("applies page color updates to all keys even when only one slot assignment is known", async () => {
    const { SlotAction, setSlotClient, resetSlots } = await import("../actions/slot.js");
    resetSlots();

    const bridge = new FakeBridge({
      ...baseConfig(),
      macros: [
        { label: "One", text: "one" },
        { label: "Two", text: "two" },
        { label: "Three", text: "three" },
      ],
      colors: { bg: "#ffffff", text: "#1e293b", icon: "#64748b" },
    });
    setSlotClient(bridge as any);

    const action = makeKeyAction("action-1");
    const action2 = makeKeyAction("action-2");
    const action3 = makeKeyAction("action-3");
    const slot = new SlotAction();
    (slot as any).actions = [action, action2, action3];

    // Only first key has appeared/assigned so far.
    await slot.onWillAppear({
      action,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 0 } },
    } as any);

    bridge.triggerConfig({
      ...bridge.config,
      colors: { bg: "#ef4444", text: "#ffffff", icon: "#ffffff" },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(action.setImage.mock.calls.length).toBeGreaterThan(1);
    expect(action2.setImage.mock.calls.length).toBeGreaterThan(0);
    expect(action3.setImage.mock.calls.length).toBeGreaterThan(0);

    const svg1 = latestSvg(action);
    const svg2 = latestSvg(action2);
    const svg3 = latestSvg(action3);

    expect(svg1).toContain("One");
    expect(svg2).toContain("Two");
    expect(svg3).toContain("Three");
    expect(svg1).toContain('fill="#ef4444"');
    expect(svg2).toContain('fill="#ef4444"');
    expect(svg3).toContain('fill="#ef4444"');
  });

  it("converges all active keys after rapid color updates", async () => {
    const { SlotAction, setSlotClient, resetSlots } = await import("../actions/slot.js");
    resetSlots();

    const bridge = new FakeBridge({
      ...baseConfig(),
      macros: Array.from({ length: 6 }, (_v, i) => ({ label: `M${i + 1}`, text: `m${i + 1}` })),
      colors: { bg: "#ffffff", text: "#1e293b", icon: "#64748b" },
    });
    setSlotClient(bridge as any);

    const actions = Array.from({ length: 6 }, (_v, i) => makeKeyAction(`action-${i + 1}`));
    const slot = new SlotAction();
    (slot as any).actions = actions;

    for (const [i, action] of actions.entries()) {
      await slot.onWillAppear({
        action,
        payload: { isInMultiAction: false, coordinates: { row: Math.floor(i / 5), column: i % 5 } },
      } as any);
    }

    const sequence = ["#ef4444", "#22c55e", "#1e3a5f", "#f59e0b", "#8b5cf6"];
    for (const color of sequence) {
      bridge.triggerConfig({ ...bridge.config, colors: { bg: color, text: "#ffffff", icon: "#ffffff" } });
    }
    await new Promise((r) => setTimeout(r, 0));

    for (const action of actions) {
      expect(latestSvg(action)).toContain(`fill="${sequence[sequence.length - 1]}"`);
    }
  });

  it("re-renders all keys even if only one config listener fires", async () => {
    const { SlotAction, setSlotClient, resetSlots } = await import("../actions/slot.js");
    resetSlots();

    const bridge = new FakeBridge({
      ...baseConfig(),
      macros: [
        { label: "One", text: "one" },
        { label: "Two", text: "two" },
        { label: "Three", text: "three" },
      ],
      colors: { bg: "#ffffff", text: "#1e293b", icon: "#64748b" },
    });
    setSlotClient(bridge as any);

    const action1 = makeKeyAction("action-1");
    const action2 = makeKeyAction("action-2");
    const action3 = makeKeyAction("action-3");
    const slot1 = new SlotAction();
    const slot2 = new SlotAction();
    const slot3 = new SlotAction();
    (slot1 as any).actions = [action1];
    (slot2 as any).actions = [action2];
    (slot3 as any).actions = [action3];

    await slot1.onWillAppear({
      action: action1,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 0 } },
    } as any);
    await slot2.onWillAppear({
      action: action2,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 1 } },
    } as any);
    await slot3.onWillAppear({
      action: action3,
      payload: { isInMultiAction: false, coordinates: { row: 0, column: 2 } },
    } as any);

    bridge.triggerConfigFirstOnly({
      ...bridge.config,
      colors: { bg: "#ef4444", text: "#ffffff", icon: "#ffffff" },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(latestSvg(action1)).toContain('fill="#ef4444"');
    expect(latestSvg(action2)).toContain('fill="#ef4444"');
    expect(latestSvg(action3)).toContain('fill="#ef4444"');
  });
});
