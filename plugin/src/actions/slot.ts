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
  type MacroInput,
} from "../layouts.js";
import { PI_PROTOCOL_VERSION } from "../protocol.js";

let bridgeRef: BridgeClient | null = null;
const activeKeyActions = new Map<string, WillAppearEvent["action"]>();

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

/** Tracks buttons that disappeared and may be part of a drag-swap. */
const pendingMoves = new Map<string, { oldSlotIndex: number; timestamp: number }>();
/** Tracks completed moves (appeared at new position) for swap detection. */
const recentMoves = new Map<string, { from: number; to: number; timestamp: number }>();
const SWAP_DEBOUNCE_MS = 300;

/** Get physical slot index for an action (row * columns + column). */
function getSlotIndex(actionId: string): number {
  return slotAssignments.get(actionId) ?? -1;
}

/** Exported for testing. */
export function resetSlots(): void {
  slotAssignments.clear();
  pendingMoves.clear();
  recentMoves.clear();
}

@action({ UUID: "com.decky.controller.slot" })
export class SlotAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubState?: () => void;
  private unsubConfig?: () => void;
  private unsubBridgeEvent?: () => void;
  private activePiActionId?: string;
  private widgetInterval?: ReturnType<typeof setInterval>;
  private animationAbort: AbortController | null = null;
  private lastRenderedState: string = "";
  private lastApprovalSnapshot: StateSnapshot | null = null;
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

    // Compute slot index from physical position on the deck
    let slotIndex: number | undefined;
    if (!ev.payload.isInMultiAction) {
      const { column, row } = ev.payload.coordinates;
      const columns = ev.action.device.size.columns;
      const physicalIndex = row * columns + column;
      slotIndex = physicalIndex;
      slotAssignments.set(ev.action.id, physicalIndex);
      pushDebug("willAppear", ev.action.id, getSlotIndex(ev.action.id), { slotIndex });

      // Check for drag-swap: did this action move from a different position?
      const pending = pendingMoves.get(ev.action.id);
      pendingMoves.delete(ev.action.id);
      if (pending && pending.oldSlotIndex !== physicalIndex && (Date.now() - pending.timestamp) < SWAP_DEBOUNCE_MS) {
        this.recordMoveAndCheckSwap(ev.action.id, pending.oldSlotIndex, physicalIndex);
      }
    }

    if (!bridgeRef) return;

    // Render this specific action immediately (it may not be in this.actions yet)
    if (slotIndex !== undefined) {
      const assignedSlot = getSlotIndex(ev.action.id);
      const connStatus = bridgeRef.getConnectionStatus();
      const snapshot = bridgeRef.getLastSnapshot();
      const state = connStatus === "connected" ? (snapshot?.state ?? "idle") : "stopped";
      const macros = this.getMacros();
      const config = getSlotConfig(state, assignedSlot, snapshot?.tool, macros, snapshot?.approval ?? null);
      const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;
      pushDebug("initialRender", ev.action.id, assignedSlot, {
        state,
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
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const oldSlotIndex = getSlotIndex(ev.action.id);
    pushDebug("willDisappear", ev.action.id, oldSlotIndex, {});

    // Save old position for drag-swap detection
    if (oldSlotIndex !== -1) {
      pendingMoves.set(ev.action.id, { oldSlotIndex, timestamp: Date.now() });
    }

    activeKeyActions.delete(ev.action.id);
    slotAssignments.delete(ev.action.id);

    // If no more instances, clean up listeners
    if (activeKeyActions.size === 0) {
      this.unsubConnection?.();
      this.unsubState?.();
      this.unsubConfig?.();
      this.unsubBridgeEvent?.();
      this.unsubConnection = undefined;
      this.unsubState = undefined;
      this.unsubConfig = undefined;
      this.unsubBridgeEvent = undefined;
      if (this.widgetInterval) {
        clearInterval(this.widgetInterval);
        this.widgetInterval = undefined;
      }
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!bridgeRef) return;

    const slotIndex = getSlotIndex(ev.action.id);
    if (slotIndex === -1) return;

    const snapshot = bridgeRef.getLastSnapshot();
    const state = snapshot?.state ?? "idle";
    const macros = this.getMacros();
    const config = getSlotConfig(state, slotIndex, snapshot?.tool, macros, snapshot?.approval ?? null);

    if (config.action === "widget-refresh") {
      await this.renderAll(bridgeRef.getConnectionStatus(), snapshot);
      return;
    }

    if (config.action && bridgeRef.getConnectionStatus() === "connected") {
      const actionId = bridgeRef.sendAction(config.action, config.data);
      pushDebug("slotActionDispatched", ev.action.id, slotIndex, {
        action: config.action,
        actionId,
      });
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

    const macros = [...cfg.macros];
    // Pad with empty macros if needed
    const maxIndex = Math.max(indexA, indexB);
    while (macros.length <= maxIndex) {
      macros.push({ label: "", text: "" });
    }
    if (indexA < 0 || indexB < 0) return;

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

    bridgeRef.sendAction("updateConfig", { macros });
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

  private getMacros(): MacroInput[] | undefined {
    const cfg = bridgeRef?.getLastConfig();
    if (cfg?.theme) setTheme(cfg.theme);
    setThemeSeed(cfg?.themeSeed ?? 0);
    setDefaultColors(cfg?.colors ?? {});
    setWidgetRenderContext({
      connectionStatus: bridgeRef?.getConnectionStatus() ?? "disconnected",
      state: bridgeRef?.getLastSnapshot()?.state,
      timestamp: bridgeRef?.getLastSnapshot()?.timestamp,
    });
    setTargetBadgeOptions({
      showTargetBadge: cfg?.showTargetBadge ?? false,
      defaultTargetApp: cfg?.defaultTargetApp ?? "claude",
    });
    this.syncWidgetInterval(cfg?.macros ?? []);
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

  private syncWidgetInterval(macros: Array<{ type?: string; widget?: { refreshMode?: string; intervalMinutes?: number } }>): void {
    const minutes = macros
      .filter((m) => m.type === "widget" && m.widget?.refreshMode === "interval")
      .map((m) => {
        const n = Number(m.widget?.intervalMinutes ?? 1);
        return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.floor(n) : 1;
      });
    const minMinutes = minutes.length ? Math.min(...minutes) : 0;
    if (this.widgetInterval) {
      clearInterval(this.widgetInterval);
      this.widgetInterval = undefined;
    }
    if (minMinutes > 0) {
      this.widgetInterval = setInterval(() => {
        this.renderAll(bridgeRef?.getConnectionStatus() ?? "disconnected", bridgeRef?.getLastSnapshot() ?? null).catch(() => {});
      }, minMinutes * 60_000);
    }
  }

  private async renderAll(connStatus: ConnectionStatus, snapshot: StateSnapshot | null): Promise<void> {
    const state = connStatus === "connected" ? (snapshot?.state ?? "idle") : "stopped";
    const toolName = snapshot?.tool;
    const macros = this.getMacros();

    // Detect transition INTO awaiting-approval → run slide-in animation
    const isNewApproval =
      state === "awaiting-approval" &&
      this.lastRenderedState !== "awaiting-approval";

    // Detect transition OUT OF awaiting-approval → run slide-out animation
    const isLeavingApproval =
      state !== "awaiting-approval" &&
      this.lastRenderedState === "awaiting-approval";

    const prevApprovalSnapshot = this.lastApprovalSnapshot;
    this.lastRenderedState = state;
    if (state === "awaiting-approval") {
      this.lastApprovalSnapshot = snapshot;
    }

    if (isNewApproval) {
      await this.animateApprovalSlideIn(snapshot, macros);
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

      const config = getSlotConfig(state, slotIndex, toolName, macros, snapshot?.approval ?? null);
      const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;

      try {
        pushDebug("renderAll:setImage", instance.id, slotIndex, {
          state,
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
   * Animated slide-in for approval buttons (slots 0-3).
   * Phase 1: Clear all keys to black.
   * Phase 2: Slide each approval button in from the right over ~500ms.
   */
  private async animateApprovalSlideIn(
    snapshot: StateSnapshot | null,
    macros: MacroInput[] | undefined,
  ): Promise<void> {
    // Cancel any in-progress animation
    this.animationAbort?.abort();
    const abort = new AbortController();
    this.animationAbort = abort;

    const approval = snapshot?.approval ?? null;
    const toolName = snapshot?.tool;
    const allActions = this.getRenderableActions();

    // --- Phase 1: Clear all keys to black ---
    const blackImg = `data:image/svg+xml,${encodeURIComponent(blackSVG())}`;
    await Promise.all(
      [...allActions.values()].map(async (instance) => {
        try {
          await instance.setImage(blackImg);
          await instance.setTitle("");
        } catch { /* key may have disappeared */ }
      }),
    );

    if (abort.signal.aborted) return;
    await new Promise((r) => setTimeout(r, 50));
    if (abort.signal.aborted) return;

    // --- Phase 2: Slide-in for slots 0-3 ---
    const approvalSlots: Array<{
      instance: WillAppearEvent["action"];
      finalSvg: string;
      slotIndex: number;
    }> = [];

    for (const [actionId, instance] of allActions) {
      const slotIndex = getSlotIndex(actionId);
      if (slotIndex >= 0 && slotIndex <= 3) {
        const config = getSlotConfig("awaiting-approval", slotIndex, toolName, macros, approval);
        approvalSlots.push({ instance, finalSvg: config.svg, slotIndex });
      }
    }

    const TOTAL_DURATION = 500;
    const FRAME_COUNT = 8;
    const STAGGER_DELAY = 40; // ms between each slot starting
    const FRAME_INTERVAL = TOTAL_DURATION / FRAME_COUNT;

    function easeOutCubic(t: number): number {
      return 1 - Math.pow(1 - t, 3);
    }

    for (let frame = 0; frame <= FRAME_COUNT; frame++) {
      if (abort.signal.aborted) return;
      const frameStart = Date.now();

      await Promise.all(
        approvalSlots.map(async ({ instance, finalSvg, slotIndex }) => {
          if (abort.signal.aborted) return;

          const slotProgress = frame / FRAME_COUNT - (slotIndex * STAGGER_DELAY) / TOTAL_DURATION;
          const clamped = Math.max(0, Math.min(1, slotProgress));
          const eased = easeOutCubic(clamped);
          const xOffset = Math.round(144 * (1 - eased));

          const svg = xOffset === 0 ? finalSvg : slideInFrame(finalSvg, xOffset);
          const imageData = `data:image/svg+xml,${encodeURIComponent(svg)}`;
          try { await instance.setImage(imageData); } catch { /* */ }
        }),
      );

      if (frame < FRAME_COUNT) {
        const elapsed = Date.now() - frameStart;
        const wait = Math.max(0, FRAME_INTERVAL - elapsed);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    }

    if (abort.signal.aborted) return;

    // --- Restore non-approval slots (4+) to their proper state ---
    await Promise.all(
      [...allActions.entries()]
        .filter(([id]) => getSlotIndex(id) > 3)
        .map(async ([id, instance]) => {
          const slotIndex = getSlotIndex(id);
          const config = getSlotConfig("awaiting-approval", slotIndex, toolName, macros, approval);
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

    // Collect current approval button SVGs for the departure animation
    const approvalSlots: Array<{
      instance: WillAppearEvent["action"];
      currentSvg: string;
      slotIndex: number;
    }> = [];

    for (const [actionId, instance] of allActions) {
      const slotIndex = getSlotIndex(actionId);
      if (slotIndex >= 0 && slotIndex <= 3) {
        const config = getSlotConfig("awaiting-approval", slotIndex, toolName, macros, approval);
        approvalSlots.push({ instance, currentSvg: config.svg, slotIndex });
      }
    }

    const TOTAL_DURATION = 300;
    const FRAME_COUNT = 6;
    const STAGGER_DELAY = 30;
    const FRAME_INTERVAL = TOTAL_DURATION / FRAME_COUNT;

    function easeInCubic(t: number): number {
      return t * t * t;
    }

    for (let frame = 0; frame <= FRAME_COUNT; frame++) {
      if (abort.signal.aborted) return;
      const frameStart = Date.now();

      await Promise.all(
        approvalSlots.map(async ({ instance, currentSvg, slotIndex }) => {
          if (abort.signal.aborted) return;

          const slotProgress = frame / FRAME_COUNT - (slotIndex * STAGGER_DELAY) / TOTAL_DURATION;
          const clamped = Math.max(0, Math.min(1, slotProgress));
          const eased = easeInCubic(clamped);
          const yOffset = Math.round(-144 * eased);

          const svg = yOffset === 0 ? currentSvg : slideOutFrame(currentSvg, yOffset);
          const imageData = `data:image/svg+xml,${encodeURIComponent(svg)}`;
          try { await instance.setImage(imageData); } catch { /* */ }
        }),
      );

      if (frame < FRAME_COUNT) {
        const elapsed = Date.now() - frameStart;
        const wait = Math.max(0, FRAME_INTERVAL - elapsed);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    }

    if (abort.signal.aborted) return;

    // Render all keys in the new state
    const newState = newSnapshot?.state ?? "idle";
    await Promise.all(
      [...allActions.entries()].map(async ([actionId, instance]) => {
        const slotIndex = getSlotIndex(actionId);
        if (slotIndex === -1) return;
        const config = getSlotConfig(newState, slotIndex, newSnapshot?.tool, macros, newSnapshot?.approval ?? null);
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
}
