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
import { getSlotConfig, setTheme, setDefaultColors, type MacroInput } from "../layouts.js";

let bridgeRef: BridgeClient | null = null;

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

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    // Compute slot index from physical position on the deck
    let slotIndex: number | undefined;
    if (!ev.payload.isInMultiAction) {
      const { column, row } = ev.payload.coordinates;
      const columns = ev.action.device.size.columns;
      slotIndex = row * columns + column;
      slotAssignments.set(ev.action.id, slotIndex);
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
      await ev.action.setImage(imageData);
      await ev.action.setTitle("");
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
      });
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
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

  override async onPropertyInspectorDidAppear(_ev: PropertyInspectorDidAppearEvent): Promise<void> {
    await this.sendConfigSnapshot();
  }

  private async sendConfigSnapshot(): Promise<void> {
    // Wait for the SDK's UIController to have the PI action reference;
    // without it, sendToPropertyInspector silently drops the message.
    for (let i = 0; i < 20 && !streamDeck.ui.action; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const cfg = bridgeRef?.getLastConfig();
    const macros = cfg?.macros ?? [];
    const snapshot: Record<string, unknown> = {
      type: "configSnapshot",
      macros: macros.map((m) => {
        const entry: Record<string, unknown> = { label: m.label, text: m.text, icon: m.icon };
        if (m.colors) entry.colors = m.colors;
        return entry;
      }),
      theme: cfg?.theme ?? "light",
      editor: cfg?.editor ?? "bbedit",
      approvalTimeout: cfg?.approvalTimeout ?? 30,
    };
    if (cfg?.colors) snapshot.colors = cfg.colors;
    await streamDeck.ui.sendToPropertyInspector(snapshot as JsonObject);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
    const payload = ev.payload as Record<string, unknown>;
    if (payload?.type === "piReady") {
      // PI is ready to receive — send the config snapshot now
      await this.sendConfigSnapshot();
      return;
    }
    if (payload?.type === "updateConfig") {
      const update: Record<string, unknown> = {};
      if (Array.isArray(payload.macros)) update.macros = payload.macros;
      if (typeof payload.theme === "string") update.theme = payload.theme;
      if (typeof payload.editor === "string") update.editor = payload.editor;
      if (typeof payload.approvalTimeout === "number") update.approvalTimeout = payload.approvalTimeout;
      if (payload.colors && typeof payload.colors === "object") update.colors = payload.colors;
      bridgeRef?.sendAction("updateConfig", update);
    }
  }

  private getMacros(): MacroInput[] | undefined {
    const cfg = bridgeRef?.getLastConfig();
    if (cfg?.theme) setTheme(cfg.theme);
    if (cfg?.colors) setDefaultColors(cfg.colors);
    if (!cfg?.macros?.length) return undefined;
    return cfg.macros.map((m) => ({
      label: m.label,
      text: m.text,
      icon: m.icon,
      colors: m.colors,
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
        await instance.setImage(imageData);
        await instance.setTitle("");
      } catch {
        // SDK may throw if the action disappeared mid-render; safe to ignore.
      }
    }
  }
}
