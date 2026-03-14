/**
 * Slot action — a generic deck button that dynamically changes its
 * appearance and behavior based on the current bridge state.
 *
 * The user places multiple "Decky Slot" instances on their deck.
 * Each instance auto-assigns a slot index (0, 1, 2, …) and looks up
 * the appropriate icon/title/action from the layout definitions.
 */

import streamDeck, {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
} from "@elgato/streamdeck";
import type { JsonValue, JsonObject } from "@elgato/utils";
import { type BridgeClient, type ConnectionStatus, type StateSnapshot } from "../bridge-client.js";
import {
  getSlotConfig,
  slideInFrame,
  slideOutFrame,
  blackSVG,
  setTheme,
  setThemeSeed,
  setDefaultColors,
  setTargetBadgeOptions,
  setWidgetRenderContext,
  setPomodoroState,
  clearPomodoroState,
  setCountUpState,
  clearCountUpState,
  type MacroInput,
} from "../layouts.js";
import { pomodoroRegistry, ADD_SECONDS } from "../pomodoro.js";
import { countUpRegistry } from "../countup.js";
import { PI_PROTOCOL_VERSION } from "../protocol.js";

let bridgeRef: BridgeClient | null = null;
const activeKeyActions = new Map<string, WillAppearEvent["action"]>();
const keyDownTimestamps = new Map<string, number>();
const LONG_PRESS_MS = 500;

interface DebugEntry extends JsonObject {
  ts: number;
  event: string;
  actionId?: string;
  slotIndex?: number;
  details?: JsonObject;
}

const debugLog: DebugEntry[] = [];
const DEBUG_MAX = 200;

function pushDebug(event: string, actionId?: string, slotIndex?: number, details?: JsonObject): void {
  debugLog.push({ ts: Date.now(), event, actionId, slotIndex, details });
  if (debugLog.length > DEBUG_MAX) debugLog.splice(0, debugLog.length - DEBUG_MAX);
}

function recentDebug(): DebugEntry[] {
  return debugLog.slice(-80);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

interface AnimationSlot {
  instance: WillAppearEvent["action"];
  svg: string;
  slotIndex: number;
}

/**
 * Run a staggered frame animation over the given slots.
 * `computeFrame` returns the SVG string for a slot at the given eased progress (0→1).
 */
async function runFrameAnimation(
  abort: AbortController,
  slots: AnimationSlot[],
  params: { duration: number; frames: number; stagger: number },
  computeFrame: (slot: AnimationSlot, eased: number) => string,
): Promise<void> {
  const { duration, frames, stagger } = params;
  const interval = duration / frames;

  for (let frame = 0; frame <= frames; frame++) {
    if (abort.signal.aborted) return;
    const frameStart = Date.now();

    await Promise.all(
      slots.map(async (slot) => {
        if (abort.signal.aborted) return;
        const progress = frame / frames - (slot.slotIndex * stagger) / duration;
        const clamped = Math.max(0, Math.min(1, progress));
        const svg = computeFrame(slot, clamped);
        const imageData = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        try { await slot.instance.setImage(imageData); } catch { /* */ }
      }),
    );

    if (frame < frames) {
      const elapsed = Date.now() - frameStart;
      const wait = Math.max(0, interval - elapsed);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function debugSummary(): JsonObject {
  const cfg = bridgeRef?.getLastConfig();
  return {
    connection: bridgeRef?.getConnectionStatus() ?? "none",
    theme: cfg?.theme ?? null,
    hasPageColors: !!cfg?.colors,
    macroCount: cfg?.macros?.length ?? 0,
    macroColorCount: cfg?.macros?.filter((m) => !!m.colors).length ?? 0,
    defaultTargetApp: cfg?.defaultTargetApp ?? null,
    showTargetBadge: cfg?.showTargetBadge ?? false,
  };
}

function summarizeSvg(svg: string): JsonObject {
  const fills = svg.match(/fill="[^"]+"/g)?.slice(0, 6) ?? [];
  const strokes = svg.match(/stroke="[^"]+"/g)?.slice(0, 4) ?? [];
  return { fills, strokes, len: svg.length };
}

export function setSlotClient(client: BridgeClient): void {
  bridgeRef = client;
}

/** Map from action context ID to position index (row * columns + column). */
const slotAssignments = new Map<string, number>();
/** Map from action context ID to Stream Deck device key. */
const actionDeviceKeys = new Map<string, string>();

/** Tracks completed moves (appeared at new position) for swap detection. */
const recentMoves = new Map<string, { from: number; to: number; timestamp: number }>();
const SWAP_DEBOUNCE_MS = 300;

/** Get physical slot index for an action (row * columns + column). */
function getSlotIndex(actionId: string): number {
  return slotAssignments.get(actionId) ?? -1;
}

function resolveDeviceKey(action: { device?: unknown }): string {
  const device = action.device;
  if (!device || typeof device !== "object") return "unknown";
  const record = device as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (id.length > 0) return `id:${id}`;
  const sizeObj = record.size;
  const size = sizeObj && typeof sizeObj === "object" ? (sizeObj as Record<string, unknown>) : null;
  const columns = size && typeof size.columns === "number" ? size.columns : null;
  const rows = size && typeof size.rows === "number" ? size.rows : null;
  const rawType = record.type;
  const typeLabel = typeof rawType === "number" || typeof rawType === "string" ? String(rawType) : "unknown";
  if (columns !== null || rows !== null) {
    return `shape:${typeLabel}:${columns ?? "?"}x${rows ?? "?"}`;
  }
  return `shape:${typeLabel}`;
}

function getDeviceKey(actionId: string): string {
  return actionDeviceKeys.get(actionId) ?? "unknown";
}

function getApprovalAnchorSlot(deviceKey: string): number | null {
  let anchor: number | null = null;
  for (const [actionId, slotIndex] of slotAssignments.entries()) {
    if (slotIndex < 0) continue;
    if (getDeviceKey(actionId) !== deviceKey) continue;
    if (anchor === null || slotIndex < anchor) anchor = slotIndex;
  }
  return anchor;
}

function resolveLayoutSlotIndex(state: string, physicalSlotIndex: number, deviceKey: string): number {
  if (state !== "awaiting-approval" && state !== "asking") return physicalSlotIndex;
  const anchor = getApprovalAnchorSlot(deviceKey);
  if (anchor === null) return physicalSlotIndex;
  return physicalSlotIndex - anchor;
}

/** Exported for testing. */
export function resetSlots(): void {
  slotAssignments.clear();
  actionDeviceKeys.clear();
  recentMoves.clear();
}

/**
 * Emit a slotHeartbeat to the bridge with the current active slot layout.
 * Called on willAppear and willDisappear so the bridge always has an up-to-date
 * picture of which physical buttons have Decky slots assigned.
 */
function emitSlotHeartbeat(triggerAction: WillAppearEvent["action"] | WillDisappearEvent["action"]): void {
  if (!bridgeRef) return;
  const device = triggerAction.device;
  const deviceId = device?.id ?? "unknown";
  const size = device?.size;
  const rows = typeof size?.rows === "number" ? size.rows : 0;
  const cols = typeof size?.columns === "number" ? size.columns : 0;
  const buttonCount = rows * cols;
  // device.type is a numeric enum; convert to string for the heartbeat payload
  const model = device?.type !== undefined ? String(device.type) : "unknown";

  const activeSlots: Array<{ row: number; col: number; index: number; label?: string }> = [];
  const cfg = bridgeRef.getLastConfig();
  for (const [, physicalIndex] of slotAssignments.entries()) {
    if (physicalIndex < 0) continue;
    const row = cols > 0 ? Math.floor(physicalIndex / cols) : 0;
    const col = cols > 0 ? physicalIndex % cols : 0;
    const label = cfg?.macros?.[physicalIndex]?.label ?? undefined;
    activeSlots.push({ row, col, index: physicalIndex, ...(label !== undefined ? { label } : {}) });
  }
  activeSlots.sort((a, b) => a.index - b.index);

  bridgeRef.sendEvent("slotHeartbeat", {
    deviceId,
    model,
    rows,
    cols,
    buttonCount,
    activeSlots,
  });
}

@action({ UUID: "com.decky.controller.slot" })
export class SlotAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubState?: () => void;
  private unsubConfig?: () => void;
  private unsubBridgeEvent?: () => void;
  private unsubPomodoro?: () => void;
  private unsubCountUp?: () => void;
  private activePiActionId?: string;
  private animationAbort: AbortController | null = null;
  private lastRenderedState: string = "";
  private lastApprovalSnapshot: StateSnapshot | null = null;
  private lastAskingSnapshot: StateSnapshot | null = null;
  private getRenderableActions(): Map<string, WillAppearEvent["action"]> {
    const all = new Map<string, WillAppearEvent["action"]>(activeKeyActions);
    for (const action of this.actions) {
      if ("setImage" in action && "setTitle" in action && !all.has(action.id)) {
        all.set(action.id, action as WillAppearEvent["action"]);
      }
    }
    return all;
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    activeKeyActions.set(ev.action.id, ev.action);
    actionDeviceKeys.set(ev.action.id, resolveDeviceKey(ev.action));

    // Compute slot index from physical position on the deck
    let slotIndex: number | undefined;
    if (!ev.payload.isInMultiAction) {
      const { column, row } = ev.payload.coordinates;
      const columns = ev.action.device.size.columns;
      const physicalIndex = row * columns + column;
      slotIndex = physicalIndex;
      slotAssignments.set(ev.action.id, physicalIndex);
      pushDebug("willAppear", ev.action.id, getSlotIndex(ev.action.id), { slotIndex });

      // Settings-based drag-swap detection: when the StreamDeck canvas swaps
      // two instances, each instance's stored settings travel with it.  If the
      // stored macroIndex differs from the physical position, this instance was
      // dragged here from somewhere else.
      const settings = ev.payload.settings as Record<string, unknown>;
      const storedIndex = typeof settings?.macroIndex === "number" ? settings.macroIndex : -1;
      if (storedIndex >= 0 && storedIndex !== physicalIndex) {
        this.recordMoveAndCheckSwap(ev.action.id, storedIndex, physicalIndex);
      }

      // Persist current physical position so future drags are detected.
      ev.action.setSettings({ macroIndex: physicalIndex } as JsonObject).catch(() => {});

      // Emit slot heartbeat so the bridge can report deck layout via /status.
      if (bridgeRef?.getConnectionStatus() === "connected") {
        emitSlotHeartbeat(ev.action);
      }
    }

    if (!bridgeRef) return;

    // Render this specific action immediately (it may not be in this.actions yet)
    if (slotIndex !== undefined) {
      const assignedSlot = getSlotIndex(ev.action.id);
      const connStatus = bridgeRef.getConnectionStatus();
      const snapshot = bridgeRef.getLastSnapshot();
      const state = connStatus === "connected" ? (snapshot?.state ?? "idle") : "stopped";
      const deviceKey = getDeviceKey(ev.action.id);
      const layoutSlotIndex = resolveLayoutSlotIndex(state, assignedSlot, deviceKey);
      const anchorSlot = state === "awaiting-approval" ? getApprovalAnchorSlot(deviceKey) : null;
      const macros = this.syncThemeAndGetMacros();
      const config = getSlotConfig(state, layoutSlotIndex, snapshot?.tool, macros, snapshot?.approval ?? null, snapshot?.question ?? null);
      const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;
      pushDebug("initialRender", ev.action.id, assignedSlot, {
        state,
        anchorSlot,
        layoutSlotIndex,
        tool: snapshot?.tool ?? null,
        title: config.title,
        action: config.action ?? null,
        svg: summarizeSvg(config.svg),
      });
      await ev.action.setImage(imageData);
      await ev.action.setTitle("");
      // Ensure all active keys converge after each appear event.
      this.renderAll(connStatus, snapshot).catch(() => {});
    }

    // Subscribe to changes (only once — first instance sets up listeners)
    if (!this.unsubConnection) {
      this.unsubConnection = bridgeRef.onConnectionChange((status) => {
        this.renderAll(status, bridgeRef!.getLastSnapshot()).catch(() => {});
      });
    }

    if (!this.unsubState) {
      this.unsubState = bridgeRef.onStateChange((snapshot) => {
        this.renderAll(bridgeRef!.getConnectionStatus(), snapshot).catch(() => {});
      });
    }

    if (!this.unsubConfig) {
      this.unsubConfig = bridgeRef.onConfigChange(() => {
        this.renderAll(bridgeRef!.getConnectionStatus(), bridgeRef!.getLastSnapshot()).catch(() => {});
        this.sendConfigSnapshot(this.activePiActionId).catch(() => {});
      });
    }

    if (!this.unsubBridgeEvent) {
      this.unsubBridgeEvent = bridgeRef.onBridgeEvent((event, payload) => {
        if (!this.activePiActionId) return;
        streamDeck.ui.sendToPropertyInspector({
          type: event,
          ...(payload && typeof payload === "object" ? payload as Record<string, unknown> : { payload }),
        } as JsonObject).catch(() => {});
      });
    }

    if (!this.unsubPomodoro) {
      this.unsubPomodoro = pomodoroRegistry.subscribe((timerId, state) => {
        this.renderPomodoroSlots(timerId, state).catch(() => {});
      });
    }

    if (!this.unsubCountUp) {
      this.unsubCountUp = countUpRegistry.subscribe((timerId, state) => {
        this.renderCountUpSlots(timerId, state).catch(() => {});
      });
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const oldSlotIndex = getSlotIndex(ev.action.id);
    pushDebug("willDisappear", ev.action.id, oldSlotIndex, {});

    activeKeyActions.delete(ev.action.id);
    slotAssignments.delete(ev.action.id);
    actionDeviceKeys.delete(ev.action.id);

    // Emit updated heartbeat (slot removed) if still connected.
    if (bridgeRef?.getConnectionStatus() === "connected") {
      emitSlotHeartbeat(ev.action);
    }

    // If no more instances, clean up listeners
    if (activeKeyActions.size === 0) {
      this.unsubConnection?.();
      this.unsubState?.();
      this.unsubConfig?.();
      this.unsubBridgeEvent?.();
      this.unsubPomodoro?.();
      this.unsubCountUp?.();
      this.unsubConnection = undefined;
      this.unsubState = undefined;
      this.unsubConfig = undefined;
      this.unsubBridgeEvent = undefined;
      this.unsubPomodoro = undefined;
      this.unsubCountUp = undefined;
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!bridgeRef) return;

    const slotIndex = getSlotIndex(ev.action.id);
    if (slotIndex === -1) return;

    const snapshot = bridgeRef.getLastSnapshot();
    const state = snapshot?.state ?? "idle";
    const deviceKey = getDeviceKey(ev.action.id);
    const layoutSlotIndex = resolveLayoutSlotIndex(state, slotIndex, deviceKey);
    const macros = this.syncThemeAndGetMacros();
    const config = getSlotConfig(state, layoutSlotIndex, snapshot?.tool, macros, snapshot?.approval ?? null, snapshot?.question ?? null);

    if (config.action === "pomodoro-add" || config.action === "count-up-toggle") {
      // Record timestamp; actual action happens in onKeyUp (short vs long press)
      keyDownTimestamps.set(ev.action.id, Date.now());
      return;
    }

    if (config.action === "widget-refresh") {
      bridgeRef.sendAction("requestState");
      return;
    }

    if (config.action && bridgeRef.getConnectionStatus() === "connected") {
      const actionId = bridgeRef.sendAction(config.action, config.data);
      pushDebug("slotActionDispatched", ev.action.id, slotIndex, {
        layoutSlotIndex,
        action: config.action,
        actionId,
      });
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const downTime = keyDownTimestamps.get(ev.action.id);
    keyDownTimestamps.delete(ev.action.id);
    if (downTime === undefined) return; // Not a tracked timer press

    if (!bridgeRef) return;
    const slotIndex = getSlotIndex(ev.action.id);
    if (slotIndex === -1) return;

    // Re-resolve config to determine which timer type this is
    const snapshot = bridgeRef.getLastSnapshot();
    const state = snapshot?.state ?? "idle";
    const deviceKey = getDeviceKey(ev.action.id);
    const layoutSlotIndex = resolveLayoutSlotIndex(state, slotIndex, deviceKey);
    const macros = this.syncThemeAndGetMacros();
    const config = getSlotConfig(state, layoutSlotIndex, snapshot?.tool, macros, snapshot?.approval ?? null, snapshot?.question ?? null);

    const held = Date.now() - downTime;
    const timerId = String(slotIndex);

    if (config.action === "pomodoro-add") {
      if (held >= LONG_PRESS_MS) {
        // Long press: reset timer to 2 seconds for testing completion visuals
        pomodoroRegistry.removeTimer(timerId);
        pomodoroRegistry.addTime(timerId, 2);
      } else {
        // Short press: add 10 minutes
        pomodoroRegistry.addTime(timerId, ADD_SECONDS);
      }
    } else if (config.action === "count-up-toggle") {
      if (held >= LONG_PRESS_MS) {
        // Long press: reset to 00:00
        countUpRegistry.reset(timerId);
      } else {
        // Short press: toggle start/pause
        countUpRegistry.toggle(timerId);
      }
    }
  }

  /**
   * Record a completed move and check if it forms a swap with a prior move.
   * A swap is detected when action A moved from→to and action B moved to→from.
   */
  private recordMoveAndCheckSwap(actionId: string, from: number, to: number): void {
    const now = Date.now();
    // Check if there's a complementary move already recorded
    for (const [otherId, move] of recentMoves) {
      if (move.from === to && move.to === from && (now - move.timestamp) < SWAP_DEBOUNCE_MS) {
        recentMoves.delete(otherId);
        this.performMacroSwap(from, to);
        return;
      }
    }
    // Record this move for future matching; clean up expired entries
    recentMoves.set(actionId, { from, to, timestamp: now });
    for (const [id, m] of recentMoves) {
      if (now - m.timestamp > SWAP_DEBOUNCE_MS * 2) recentMoves.delete(id);
    }
  }

  /** Swap two macros in the config array and send the update to the bridge. */
  private performMacroSwap(indexA: number, indexB: number): void {
    if (!bridgeRef) return;
    const cfg = bridgeRef.getLastConfig();
    if (!cfg?.macros) return;

    if (indexA < 0 || indexB < 0) return;
    const macros = [...cfg.macros];
    // Pad with empty macros if needed
    const maxIndex = Math.max(indexA, indexB);
    while (macros.length <= maxIndex) {
      macros.push({ label: "", text: "" });
    }

    // Swap
    const temp = macros[indexA];
    macros[indexA] = macros[indexB];
    macros[indexB] = temp;

    pushDebug("macroSwap", undefined, undefined, {
      indexA,
      indexB,
      labelA: macros[indexA]?.label ?? "",
      labelB: macros[indexB]?.label ?? "",
    });

    // Optimistically update the local config cache so immediate renders
    // (onWillAppear, PI snapshots) use swapped macros before bridge round-trip.
    bridgeRef.patchLocalConfig({ macros });

    bridgeRef.sendAction("updateConfig", { macros });

    // Re-render all buttons immediately with the swapped macros.
    this.renderAll(bridgeRef.getConnectionStatus(), bridgeRef.getLastSnapshot()).catch(() => {});
  }

  override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent): Promise<void> {
    this.activePiActionId = ev.action.id;
    pushDebug("piAppear", ev.action.id, getSlotIndex(ev.action.id), {});
    await this.sendConfigSnapshot(ev.action.id);
  }

  private async sendConfigSnapshot(actionId?: string): Promise<void> {
    // Wait for the SDK's UIController to have the PI action reference;
    // without it, sendToPropertyInspector silently drops the message.
    for (let i = 0; i < 20 && !streamDeck.ui.action; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const cfg = bridgeRef?.getLastConfig();
    if (!cfg) return;
    const macros = cfg?.macros ?? [];
    const selectedMacroIndex =
      actionId && slotAssignments.has(actionId) ? getSlotIndex(actionId) : undefined;
    const snapshot: Record<string, unknown> = {
      type: "configSnapshot",
      piProtocolVersion: PI_PROTOCOL_VERSION,
      macros: macros.map((m) => {
        const entry: Record<string, unknown> = {
          label: m.label,
          text: m.text,
          icon: m.icon,
          fontSize: m.fontSize,
          targetApp: m.targetApp,
          submit: m.submit,
          type: m.type,
          widget: m.widget,
        };
        if (m.colors) entry.colors = m.colors;
        return entry;
      }),
      theme: cfg?.theme ?? "light",
      themeSeed: cfg?.themeSeed ?? 0,
      approvalTimeout: cfg?.approvalTimeout ?? 30,
      defaultTargetApp: cfg?.defaultTargetApp ?? "claude",
      showTargetBadge: cfg?.showTargetBadge ?? false,
      popUpApp: cfg?.popUpApp ?? false,
      enableApproveOnce: cfg?.enableApproveOnce ?? true,
      enableDictation: cfg?.enableDictation ?? true,
      capabilities: bridgeRef?.getLastSnapshot()?.capabilities ?? null,
    };
    if (typeof selectedMacroIndex === "number" && selectedMacroIndex >= 0) {
      snapshot.selectedMacroIndex = selectedMacroIndex;
    }
    if (cfg?.colors) snapshot.colors = cfg.colors;
    pushDebug("sendConfigSnapshot", actionId, typeof selectedMacroIndex === "number" ? selectedMacroIndex : -1, {
      theme: cfg.theme,
      hasPageColors: !!cfg.colors,
      macroCount: macros.length,
      macroColorCount: macros.filter((m) => !!m.colors).length,
    });
    await streamDeck.ui.sendToPropertyInspector(snapshot as JsonObject);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
    this.activePiActionId = ev.action.id;
    const payload = ev.payload as Record<string, unknown>;
    const payloadType = typeof payload?.type === "string" ? payload.type : "unknown";
    pushDebug("pi->plugin", ev.action.id, getSlotIndex(ev.action.id), { type: payloadType });
    if (payload?.type === "piReady") {
      // PI is ready to receive — send the config snapshot now
      await this.sendConfigSnapshot(ev.action.id);
      return;
    }
    if (payload?.type === "debugRenderProbe") {
      const slotIndex = getSlotIndex(ev.action.id);
      const stamp = new Date().toISOString().slice(11, 19);
      const probeSvg = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
        <rect width="144" height="144" rx="16" fill="#ff00aa"/>
        <rect x="8" y="8" width="128" height="128" rx="12" fill="#00d1ff"/>
        <text x="72" y="74" font-size="28" font-family="sans-serif" text-anchor="middle" fill="#111">PROBE</text>
        <text x="72" y="108" font-size="18" font-family="sans-serif" text-anchor="middle" fill="#111">${stamp}</text>
      </svg>`;
      try {
        if (ev.action.isKey()) {
          await ev.action.setImage(`data:image/svg+xml,${encodeURIComponent(probeSvg)}`);
          await ev.action.setTitle("");
        }
        pushDebug("probe:setImage:ok", ev.action.id, slotIndex, { stamp });
      } catch (err) {
        pushDebug("probe:setImage:err", ev.action.id, slotIndex, { err: String(err) });
      }
      await streamDeck.ui.sendToPropertyInspector({
        type: "debugSnapshot",
        entries: recentDebug(),
        summary: debugSummary(),
      });
      return;
    }
    if (payload?.type === "debugDump") {
      await streamDeck.ui.sendToPropertyInspector({
        type: "debugSnapshot",
        entries: recentDebug(),
        summary: debugSummary(),
      });
      return;
    }
    if (payload?.type === "updateConfig") {
      const update: Record<string, unknown> = {};
      if (typeof payload.requestId === "string" && payload.requestId.trim().length > 0) {
        update.requestId = payload.requestId.trim();
      }
      if (Array.isArray(payload.macros)) update.macros = payload.macros;
      if (typeof payload.theme === "string") update.theme = payload.theme;
      if (typeof payload.themeSeed === "number" && Number.isFinite(payload.themeSeed)) {
        update.themeSeed = Math.floor(payload.themeSeed);
      }
      if (typeof payload.approvalTimeout === "number") update.approvalTimeout = payload.approvalTimeout;
      if (typeof payload.defaultTargetApp === "string") update.defaultTargetApp = payload.defaultTargetApp;
      if (typeof payload.showTargetBadge === "boolean") update.showTargetBadge = payload.showTargetBadge;
      if (typeof payload.popUpApp === "boolean") update.popUpApp = payload.popUpApp;
      if (typeof payload.enableApproveOnce === "boolean") update.enableApproveOnce = payload.enableApproveOnce;
      if (typeof payload.enableDictation === "boolean") update.enableDictation = payload.enableDictation;
      if (payload.colors && typeof payload.colors === "object") update.colors = payload.colors;
      if (
        payload.themeApplyMode === "keep" ||
        payload.themeApplyMode === "clear-page" ||
        payload.themeApplyMode === "clear-all"
      ) {
        update.themeApplyMode = payload.themeApplyMode;
      }
      bridgeRef?.sendAction("updateConfig", update);
      const debugTheme = typeof update.theme === "string" ? update.theme : null;
      const debugThemeSeed = typeof update.themeSeed === "number" ? update.themeSeed : null;
      const debugThemeApplyMode = typeof update.themeApplyMode === "string" ? update.themeApplyMode : null;
      pushDebug("plugin->bridge:updateConfig", ev.action.id, getSlotIndex(ev.action.id), {
        theme: debugTheme,
        themeSeed: debugThemeSeed,
        themeApplyMode: debugThemeApplyMode,
        hasColorsField: Object.prototype.hasOwnProperty.call(update, "colors"),
      });
    }
  }

  private syncThemeAndGetMacros(): MacroInput[] | undefined {
    const cfg = bridgeRef?.getLastConfig();
    if (cfg?.theme) setTheme(cfg.theme);
    setThemeSeed(cfg?.themeSeed ?? 0);
    setDefaultColors(cfg?.colors ?? {});
    const snap = bridgeRef?.getLastSnapshot();
    setWidgetRenderContext({
      connectionStatus: bridgeRef?.getConnectionStatus() ?? "disconnected",
      state: snap?.state,
      timestamp: snap?.timestamp,
      sessionStats: snap?.sessionStats,
    });
    setTargetBadgeOptions({
      showTargetBadge: cfg?.showTargetBadge ?? false,
      defaultTargetApp: cfg?.defaultTargetApp ?? "claude",
    });
    if (!cfg?.macros?.length) return undefined;
    return cfg.macros.map((m) => ({
      label: m.label,
      text: m.text,
      icon: m.icon,
      fontSize: m.fontSize,
      colors: m.colors,
      targetApp: m.targetApp,
      submit: m.submit,
      type: m.type,
      widget: m.widget,
    }));
  }

  private async renderAll(connStatus: ConnectionStatus, snapshot: StateSnapshot | null): Promise<void> {
    const state = connStatus === "connected" ? (snapshot?.state ?? "idle") : "stopped";
    const toolName = snapshot?.tool;
    const macros = this.syncThemeAndGetMacros();

    // Detect transition INTO awaiting-approval → run slide-in animation
    const isNewApproval =
      state === "awaiting-approval" &&
      this.lastRenderedState !== "awaiting-approval";

    // Detect transition OUT OF awaiting-approval → run slide-out animation
    const isLeavingApproval =
      state !== "awaiting-approval" &&
      this.lastRenderedState === "awaiting-approval";

    // Detect transition INTO asking → run slide-in animation
    const isNewAsking =
      state === "asking" &&
      this.lastRenderedState !== "asking";

    const prevApprovalSnapshot = this.lastApprovalSnapshot;
    this.lastRenderedState = state;
    if (state === "awaiting-approval") {
      this.lastApprovalSnapshot = snapshot;
    }
    if (state === "asking") {
      this.lastAskingSnapshot = snapshot;
    }

    if (isNewApproval) {
      await this.animateApprovalSlideIn(snapshot, macros);
      return;
    }

    if (isNewAsking) {
      await this.animateAskingSlideIn(snapshot, macros);
      return;
    }

    // Cancel any in-progress animation (e.g., user approved during slide-in)
    if (this.animationAbort) {
      this.animationAbort.abort();
      this.animationAbort = null;
    }

    if (isLeavingApproval && prevApprovalSnapshot) {
      await this.animateApprovalSlideOut(prevApprovalSnapshot, snapshot, macros);
      return;
    }

    for (const instance of this.getRenderableActions().values()) {
      const slotIndex = getSlotIndex(instance.id);
      if (slotIndex === -1) continue;

      const deviceKey = getDeviceKey(instance.id);
      const layoutSlotIndex = resolveLayoutSlotIndex(state, slotIndex, deviceKey);
      const anchorSlot = state === "awaiting-approval" ? getApprovalAnchorSlot(deviceKey) : null;
      const config = getSlotConfig(state, layoutSlotIndex, toolName, macros, snapshot?.approval ?? null, snapshot?.question ?? null);
      const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;

      try {
        pushDebug("renderAll:setImage", instance.id, slotIndex, {
          state,
          anchorSlot,
          layoutSlotIndex,
          title: config.title,
          action: config.action ?? null,
          svg: summarizeSvg(config.svg),
        });
        await instance.setImage(imageData);
        await instance.setTitle("");
      } catch {
        pushDebug("renderAll:setImage:err", instance.id, slotIndex, { state });
        // SDK may throw if the action disappeared mid-render; safe to ignore.
      }
    }
  }

  /**
   * Shared re-render for timer widget slots (pomodoro or count-up).
   * Filters to slots matching the given widget kind and re-renders them.
   */
  private async renderTimerSlots(timerId: string, widgetKind: string): Promise<void> {
    const slotIndex = Number(timerId);
    if (!Number.isFinite(slotIndex)) return;

    const macros = this.syncThemeAndGetMacros();

    for (const instance of this.getRenderableActions().values()) {
      const assignedSlot = getSlotIndex(instance.id);
      if (assignedSlot === -1) continue;

      const macro = macros?.[assignedSlot];
      if (macro?.type !== "widget" || macro.widget?.kind !== widgetKind) continue;
      if (assignedSlot !== slotIndex) continue;

      const snapshot = bridgeRef?.getLastSnapshot() ?? null;
      const connStatus = bridgeRef?.getConnectionStatus() ?? "disconnected";
      const currentState = connStatus === "connected" ? (snapshot?.state ?? "idle") : "stopped";
      const deviceKey = getDeviceKey(instance.id);
      const layoutSlotIndex = resolveLayoutSlotIndex(currentState, assignedSlot, deviceKey);
      const config = getSlotConfig(currentState, layoutSlotIndex, snapshot?.tool, macros, snapshot?.approval ?? null, snapshot?.question ?? null);
      const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;

      try {
        await instance.setImage(imageData);
        await instance.setTitle("");
      } catch {
        // Action may have disappeared mid-render; safe to ignore.
      }
    }
  }

  /**
   * Targeted re-render for Pomodoro widget slots only.
   * Called by the pomodoroRegistry subscription on every tick/flash frame.
   */
  private async renderPomodoroSlots(timerId: string, state: { remainingSeconds: number; isRunning: boolean; isFlashing: boolean }): Promise<void> {
    setPomodoroState(Number(timerId), state);
    return this.renderTimerSlots(timerId, "pomodoro");
  }

  /**
   * Targeted re-render for count-up timer widget slots only.
   * Called by the countUpRegistry subscription on every tick.
   */
  private async renderCountUpSlots(timerId: string, state: { elapsedSeconds: number; isRunning: boolean }): Promise<void> {
    setCountUpState(Number(timerId), state);
    return this.renderTimerSlots(timerId, "count-up");
  }

  /**
   * Collect animation slots for a given state and layout slot range.
   * `getSvg` returns the SVG for a layout slot index, or null to skip.
   */
  private collectLayoutSlots(
    allActions: Map<string, WillAppearEvent["action"]>,
    state: string,
    minSlot: number,
    maxSlot: number,
    getSvg: (layoutSlotIndex: number) => string | null,
  ): AnimationSlot[] {
    const result: AnimationSlot[] = [];
    for (const [actionId, instance] of allActions) {
      const slotIndex = getSlotIndex(actionId);
      if (slotIndex < 0) continue;
      const deviceKey = getDeviceKey(actionId);
      const layoutSlotIndex = resolveLayoutSlotIndex(state, slotIndex, deviceKey);
      if (layoutSlotIndex >= minSlot && layoutSlotIndex <= maxSlot) {
        const svg = getSvg(layoutSlotIndex);
        if (svg) result.push({ instance, svg, slotIndex: layoutSlotIndex });
      }
    }
    return result;
  }

  /**
   * Animated slide-in for approval buttons (slots 0-3).
   * Phase 1: Clear only the approval slots (0-3) to black; slots 4+ keep macro content.
   * Phase 2: Slide each approval button in from the right over ~500ms.
   */
  private async animateApprovalSlideIn(
    snapshot: StateSnapshot | null,
    macros: MacroInput[] | undefined,
  ): Promise<void> {
    this.animationAbort?.abort();
    const abort = new AbortController();
    this.animationAbort = abort;

    const approval = snapshot?.approval ?? null;
    const toolName = snapshot?.tool;
    const allActions = this.getRenderableActions();

    // Phase 1: Clear approval slots (0-3) to black
    const blackImg = `data:image/svg+xml,${encodeURIComponent(blackSVG())}`;
    await Promise.all(
      [...allActions.entries()].map(async ([actionId, instance]) => {
        const si = getSlotIndex(actionId);
        if (si < 0) return;
        const dk = getDeviceKey(actionId);
        const li = resolveLayoutSlotIndex("awaiting-approval", si, dk);
        if (li < 0 || li > 3) return;
        try {
          await instance.setImage(blackImg);
          await instance.setTitle("");
        } catch { /* key may have disappeared */ }
      }),
    );

    if (abort.signal.aborted) return;
    await new Promise((r) => setTimeout(r, 50));
    if (abort.signal.aborted) return;

    // Phase 2: Slide-in for slots 0-3
    const slots = this.collectLayoutSlots(allActions, "awaiting-approval", 0, 3, (li) => {
      const config = getSlotConfig("awaiting-approval", li, toolName, macros, approval);
      return config.svg;
    });

    await runFrameAnimation(abort, slots, { duration: 500, frames: 8, stagger: 40 }, (slot, eased) => {
      const xOffset = Math.round(144 * (1 - easeOutCubic(eased)));
      return xOffset === 0 ? slot.svg : slideInFrame(slot.svg, xOffset);
    });

    if (abort.signal.aborted) return;

    // Restore non-approval slots (4+)
    await Promise.all(
      [...allActions.entries()]
        .filter(([id]) => {
          const si = getSlotIndex(id);
          if (si < 0) return false;
          const dk = getDeviceKey(id);
          return resolveLayoutSlotIndex("awaiting-approval", si, dk) > 3;
        })
        .map(async ([id, instance]) => {
          const slotIndex = getSlotIndex(id);
          const deviceKey = getDeviceKey(id);
          const layoutSlotIndex = resolveLayoutSlotIndex("awaiting-approval", slotIndex, deviceKey);
          const config = getSlotConfig("awaiting-approval", layoutSlotIndex, toolName, macros, approval);
          const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;
          try { await instance.setImage(imageData); } catch { /* */ }
        }),
    );

    if (this.animationAbort === abort) {
      this.animationAbort = null;
    }
  }

  /**
   * Animated slide-out for approval buttons (slots 0-3).
   * Slides buttons upward out of view, then renders the new state.
   */
  private async animateApprovalSlideOut(
    prevApprovalSnapshot: StateSnapshot,
    newSnapshot: StateSnapshot | null,
    macros: MacroInput[] | undefined,
  ): Promise<void> {
    this.animationAbort?.abort();
    const abort = new AbortController();
    this.animationAbort = abort;

    const approval = prevApprovalSnapshot.approval ?? null;
    const toolName = prevApprovalSnapshot.tool;
    const allActions = this.getRenderableActions();

    const slots = this.collectLayoutSlots(allActions, "awaiting-approval", 0, 3, (li: number) => {
      const config = getSlotConfig("awaiting-approval", li, toolName, macros, approval);
      return config.svg;
    });

    await runFrameAnimation(abort, slots, { duration: 300, frames: 6, stagger: 30 }, (slot, eased) => {
      const yOffset = Math.round(-144 * easeInCubic(eased));
      return yOffset === 0 ? slot.svg : slideOutFrame(slot.svg, yOffset);
    });

    if (abort.signal.aborted) return;

    // Render all keys in the new state
    const newState = newSnapshot?.state ?? "idle";
    await Promise.all(
      [...allActions.entries()].map(async ([actionId, instance]) => {
        const slotIndex = getSlotIndex(actionId);
        if (slotIndex === -1) return;
        const config = getSlotConfig(newState, slotIndex, newSnapshot?.tool, macros, newSnapshot?.approval ?? null, newSnapshot?.question ?? null);
        const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;
        try {
          await instance.setImage(imageData);
          await instance.setTitle("");
        } catch { /* */ }
      }),
    );

    if (this.animationAbort === abort) {
      this.animationAbort = null;
    }
  }

  /**
   * Animated slide-in for option buttons in asking state (slots 0-3).
   * Reuses the same timing and easing as the approval slide-in.
   */
  private async animateAskingSlideIn(
    snapshot: StateSnapshot | null,
    macros: MacroInput[] | undefined,
  ): Promise<void> {
    this.animationAbort?.abort();
    const abort = new AbortController();
    this.animationAbort = abort;

    const question = snapshot?.question ?? null;
    const allActions = this.getRenderableActions();

    // Phase 1: Clear option slots (0-3) to black
    const blackImg = `data:image/svg+xml,${encodeURIComponent(blackSVG())}`;
    await Promise.all(
      [...allActions.entries()].map(async ([actionId, instance]) => {
        const si = getSlotIndex(actionId);
        if (si < 0) return;
        const dk = getDeviceKey(actionId);
        const li = resolveLayoutSlotIndex("asking", si, dk);
        if (li < 0 || li > 3) return;
        try {
          await instance.setImage(blackImg);
          await instance.setTitle("");
        } catch { /* key may have disappeared */ }
      }),
    );

    if (abort.signal.aborted) return;
    await new Promise((r) => setTimeout(r, 50));
    if (abort.signal.aborted) return;

    // Phase 2: Slide-in for option slots
    const slots = this.collectLayoutSlots(allActions, "asking", 0, 3, (li: number) => {
      const config = getSlotConfig("asking", li, null, macros, null, question);
      return config.svg && config.action ? config.svg : null;
    });

    await runFrameAnimation(abort, slots, { duration: 500, frames: 8, stagger: 40 }, (slot, eased) => {
      const xOffset = Math.round(144 * (1 - easeOutCubic(eased)));
      return xOffset === 0 ? slot.svg : slideInFrame(slot.svg, xOffset);
    });

    if (this.animationAbort === abort) {
      this.animationAbort = null;
    }
  }
}
