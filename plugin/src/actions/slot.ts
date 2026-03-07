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
import { getSlotConfig, type MacroInput } from "../layouts.js";

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
      this.unsubConnection = bridgeRef.onConnectionChange(async (status) => {
        await this.renderAll(status, bridgeRef!.getLastSnapshot());
      });
    }

    if (!this.unsubState) {
      this.unsubState = bridgeRef.onStateChange(async (snapshot) => {
        await this.renderAll(bridgeRef!.getConnectionStatus(), snapshot);
      });
    }

    if (!this.unsubConfig) {
      this.unsubConfig = bridgeRef.onConfigChange(async () => {
        await this.renderAll(bridgeRef!.getConnectionStatus(), bridgeRef!.getLastSnapshot());
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

    if (config.action && bridgeRef.getConnectionStatus() === "connected") {
      bridgeRef.sendAction(config.action, config.data);
    }
  }

  override async onPropertyInspectorDidAppear(_ev: PropertyInspectorDidAppearEvent): Promise<void> {
    const cfg = bridgeRef?.getLastConfig();
    const macros = cfg?.macros ?? [];
    await streamDeck.ui.sendToPropertyInspector({
      type: "configSnapshot",
      macros: macros.map((m) => ({ label: m.label, text: m.text, icon: m.icon })),
    });
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
    const payload = ev.payload as Record<string, unknown>;
    if (payload?.type === "updateConfig" && Array.isArray(payload.macros)) {
      bridgeRef?.sendAction("updateConfig", { macros: payload.macros });
    }
  }

  private getMacros(): MacroInput[] | undefined {
    const cfg = bridgeRef?.getLastConfig();
    if (!cfg?.macros?.length) return undefined;
    return cfg.macros.map((m) => ({ label: m.label, text: m.text, icon: m.icon }));
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

      await instance.setImage(imageData);
      await instance.setTitle("");
    }
  }
}
