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
import { exec } from "node:child_process";
import { type BridgeClient, type ConnectionStatus, type StateSnapshot } from "../bridge-client.js";
import {
  getSlotConfig,
  setTheme,
  setThemeSeed,
  setDefaultColors,
  setTargetBadgeOptions,
  type MacroInput,
} from "../layouts.js";

let bridgeRef: BridgeClient | null = null;

interface DebugEntry {
  ts: number;
  event: string;
  actionId?: string;
  slotRank?: number;
  details?: Record<string, unknown>;
}

const debugLog: DebugEntry[] = [];
const DEBUG_MAX = 200;

function pushDebug(event: string, actionId?: string, slotRank?: number, details?: Record<string, unknown>): void {
  debugLog.push({ ts: Date.now(), event, actionId, slotRank, details });
  if (debugLog.length > DEBUG_MAX) debugLog.splice(0, debugLog.length - DEBUG_MAX);
}

function recentDebug(): DebugEntry[] {
  return debugLog.slice(-80);
}

function debugSummary(): Record<string, unknown> {
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

function summarizeSvg(svg: string): Record<string, unknown> {
  const fills = svg.match(/fill="[^"]+"/g)?.slice(0, 6) ?? [];
  const strokes = svg.match(/stroke="[^"]+"/g)?.slice(0, 4) ?? [];
  return { fills, strokes, len: svg.length };
}

export function setSlotClient(client: BridgeClient): void {
  bridgeRef = client;
}

/** Map from action context ID to position index (row * columns + column). */
const slotAssignments = new Map<string, number>();

/** Get the rank (sorted order) of an action among all active slots.
 *  Macros are assigned by rank so they fill sequentially regardless of position gaps. */
function getSlotRank(actionId: string): number {
  const sorted = [...slotAssignments.entries()].sort((a, b) => a[1] - b[1]);
  return sorted.findIndex(([id]) => id === actionId);
}

/** Exported for testing. */
export function resetSlots(): void {
  slotAssignments.clear();
}

@action({ UUID: "com.decky.controller.slot" })
export class SlotAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubState?: () => void;
  private unsubConfig?: () => void;
  private activePiActionId?: string;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    // Compute slot index from physical position on the deck
    let slotIndex: number | undefined;
    if (!ev.payload.isInMultiAction) {
      const { column, row } = ev.payload.coordinates;
      const columns = ev.action.device.size.columns;
      slotIndex = row * columns + column;
      slotAssignments.set(ev.action.id, slotIndex);
      pushDebug("willAppear", ev.action.id, getSlotRank(ev.action.id), { slotIndex });
    }

    if (!bridgeRef) return;

    // Render this specific action immediately (it may not be in this.actions yet)
    if (slotIndex !== undefined) {
      const rank = getSlotRank(ev.action.id);
      const connStatus = bridgeRef.getConnectionStatus();
      const snapshot = bridgeRef.getLastSnapshot();
      const state = connStatus === "connected" ? (snapshot?.state ?? "idle") : "stopped";
      const macros = this.getMacros();
      const config = getSlotConfig(state, rank, snapshot?.tool, macros);
      const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;
      pushDebug("initialRender", ev.action.id, rank, {
        state,
        tool: snapshot?.tool ?? null,
        title: config.title,
        action: config.action ?? null,
        svg: summarizeSvg(config.svg),
      });
      await ev.action.setImage(imageData);
      await ev.action.setTitle("");
      // Ensure rank-based macro assignment converges as additional keys appear.
      // Without this, startup order can leave many keys rendered as slot 0.
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
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    pushDebug("willDisappear", ev.action.id, getSlotRank(ev.action.id), {});
    slotAssignments.delete(ev.action.id);

    // If no more instances, clean up listeners
    if (slotAssignments.size === 0) {
      this.unsubConnection?.();
      this.unsubState?.();
      this.unsubConfig?.();
      this.unsubConnection = undefined;
      this.unsubState = undefined;
      this.unsubConfig = undefined;
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!bridgeRef) return;

    const rank = getSlotRank(ev.action.id);
    if (rank === -1) return;

    const snapshot = bridgeRef.getLastSnapshot();
    const state = snapshot?.state ?? "idle";
    const macros = this.getMacros();
    const config = getSlotConfig(state, rank, snapshot?.tool, macros);

    if (config.action === "openConfig") {
      const editor = bridgeRef.getLastConfig()?.editor ?? "bbedit";
      exec(`${editor} ~/.decky/config.json`);
      return;
    }

    if (config.action && bridgeRef.getConnectionStatus() === "connected") {
      bridgeRef.sendAction(config.action, config.data);
    }
  }

  override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent): Promise<void> {
    this.activePiActionId = ev.action.id;
    pushDebug("piAppear", ev.action.id, getSlotRank(ev.action.id), {});
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
      actionId && slotAssignments.has(actionId) ? getSlotRank(actionId) : undefined;
    const snapshot: Record<string, unknown> = {
      type: "configSnapshot",
      macros: macros.map((m) => {
        const entry: Record<string, unknown> = {
          label: m.label,
          text: m.text,
          icon: m.icon,
          targetApp: m.targetApp,
        };
        if (m.colors) entry.colors = m.colors;
        return entry;
      }),
      theme: cfg?.theme ?? "light",
      themeSeed: cfg?.themeSeed ?? 0,
      editor: cfg?.editor ?? "bbedit",
      approvalTimeout: cfg?.approvalTimeout ?? 30,
      defaultTargetApp: cfg?.defaultTargetApp ?? "claude",
      showTargetBadge: cfg?.showTargetBadge ?? false,
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
    pushDebug("pi->plugin", ev.action.id, getSlotRank(ev.action.id), { type: payload?.type ?? "unknown" });
    if (payload?.type === "piReady") {
      // PI is ready to receive — send the config snapshot now
      await this.sendConfigSnapshot(ev.action.id);
      return;
    }
    if (payload?.type === "debugRenderProbe") {
      const rank = getSlotRank(ev.action.id);
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
        pushDebug("probe:setImage:ok", ev.action.id, rank, { stamp });
      } catch (err) {
        pushDebug("probe:setImage:err", ev.action.id, rank, { err: String(err) });
      }
      await streamDeck.ui.sendToPropertyInspector({
        type: "debugSnapshot",
        entries: recentDebug(),
        summary: debugSummary(),
      } as JsonObject);
      return;
    }
    if (payload?.type === "debugDump") {
      await streamDeck.ui.sendToPropertyInspector({
        type: "debugSnapshot",
        entries: recentDebug(),
        summary: debugSummary(),
      } as JsonObject);
      return;
    }
    if (payload?.type === "updateConfig") {
      const update: Record<string, unknown> = {};
      if (Array.isArray(payload.macros)) update.macros = payload.macros;
      if (typeof payload.theme === "string") update.theme = payload.theme;
      if (typeof payload.themeSeed === "number" && Number.isFinite(payload.themeSeed)) {
        update.themeSeed = Math.floor(payload.themeSeed);
      }
      if (typeof payload.editor === "string") update.editor = payload.editor;
      if (typeof payload.approvalTimeout === "number") update.approvalTimeout = payload.approvalTimeout;
      if (typeof payload.defaultTargetApp === "string") update.defaultTargetApp = payload.defaultTargetApp;
      if (typeof payload.showTargetBadge === "boolean") update.showTargetBadge = payload.showTargetBadge;
      if (payload.colors && typeof payload.colors === "object") update.colors = payload.colors;
      if (
        payload.themeApplyMode === "keep" ||
        payload.themeApplyMode === "clear-page" ||
        payload.themeApplyMode === "clear-all"
      ) {
        update.themeApplyMode = payload.themeApplyMode;
      }
      bridgeRef?.sendAction("updateConfig", update);
      pushDebug("plugin->bridge:updateConfig", ev.action.id, getSlotRank(ev.action.id), {
        theme: update.theme ?? null,
        themeSeed: update.themeSeed ?? null,
        themeApplyMode: update.themeApplyMode ?? null,
        hasColorsField: Object.prototype.hasOwnProperty.call(update, "colors"),
      });
    }
  }

  private getMacros(): MacroInput[] | undefined {
    const cfg = bridgeRef?.getLastConfig();
    if (cfg?.theme) setTheme(cfg.theme);
    setThemeSeed(cfg?.themeSeed ?? 0);
    setDefaultColors(cfg?.colors ?? {});
    setTargetBadgeOptions({
      showTargetBadge: cfg?.showTargetBadge ?? false,
    });
    if (!cfg?.macros?.length) return undefined;
    return cfg.macros.map((m) => ({
      label: m.label,
      text: m.text,
      icon: m.icon,
      colors: m.colors,
      targetApp: m.targetApp,
    }));
  }

  private async renderAll(connStatus: ConnectionStatus, snapshot: StateSnapshot | null): Promise<void> {
    const state = connStatus === "connected" ? (snapshot?.state ?? "idle") : "stopped";
    const toolName = snapshot?.tool;
    const macros = this.getMacros();

    for (const instance of this.actions) {
      const rank = getSlotRank(instance.id);
      if (rank === -1) continue;

      const config = getSlotConfig(state, rank, toolName, macros);
      const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;

      try {
        pushDebug("renderAll:setImage", instance.id, rank, {
          state,
          title: config.title,
          action: config.action ?? null,
          svg: summarizeSvg(config.svg),
        });
        await instance.setImage(imageData);
        await instance.setTitle("");
      } catch {
        pushDebug("renderAll:setImage:err", instance.id, rank, { state });
        // SDK may throw if the action disappeared mid-render; safe to ignore.
      }
    }
  }
}
