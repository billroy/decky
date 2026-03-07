/**
 * Slot action — a generic deck button that dynamically changes its
 * appearance and behavior based on the current bridge state.
 *
 * The user places multiple "Decky Slot" instances on their deck.
 * Each instance auto-assigns a slot index (0, 1, 2, …) and looks up
 * the appropriate icon/title/action from the layout definitions.
 */

import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
} from "@elgato/streamdeck";
import { type BridgeClient, type ConnectionStatus, type StateSnapshot } from "../bridge-client.js";
import { getSlotConfig, type MacroInput } from "../layouts.js";

let bridgeRef: BridgeClient | null = null;

export function setSlotClient(client: BridgeClient): void {
  bridgeRef = client;
}

/** Map from action context ID to assigned slot index. */
const slotAssignments = new Map<string, number>();
let nextSlotIndex = 0;

function getSlotIndex(contextId: string): number {
  let idx = slotAssignments.get(contextId);
  if (idx === undefined) {
    idx = nextSlotIndex++;
    slotAssignments.set(contextId, idx);
  }
  return idx;
}

function releaseSlot(contextId: string): void {
  slotAssignments.delete(contextId);
}

/** Exported for testing. */
export function resetSlots(): void {
  slotAssignments.clear();
  nextSlotIndex = 0;
}

@action({ UUID: "com.decky.controller.slot" })
export class SlotAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubState?: () => void;
  private unsubConfig?: () => void;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!bridgeRef) return;

    // Assign slot index for this instance
    const contextId = ev.action.id;
    getSlotIndex(contextId);

    // Render current state immediately
    await this.renderAll(bridgeRef.getConnectionStatus(), bridgeRef.getLastSnapshot());

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
    releaseSlot(ev.action.id);

    // If no more instances, clean up listeners
    if (slotAssignments.size === 0) {
      this.unsubConnection?.();
      this.unsubState?.();
      this.unsubConfig?.();
      this.unsubConnection = undefined;
      this.unsubState = undefined;
      this.unsubConfig = undefined;
      resetSlots();
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (!bridgeRef) return;

    const slotIndex = slotAssignments.get(ev.action.id);
    if (slotIndex === undefined) return;

    const snapshot = bridgeRef.getLastSnapshot();
    const state = snapshot?.state ?? "idle";
    const macros = this.getMacros();
    const config = getSlotConfig(state, slotIndex, snapshot?.tool, macros);

    if (config.action && bridgeRef.getConnectionStatus() === "connected") {
      bridgeRef.sendAction(config.action, config.data);
    }
  }

  private getMacros(): MacroInput[] | undefined {
    const cfg = bridgeRef?.getLastConfig();
    if (!cfg?.macros?.length) return undefined;
    return cfg.macros.map((m) => ({ label: m.label, text: m.text }));
  }

  private async renderAll(connStatus: ConnectionStatus, snapshot: StateSnapshot | null): Promise<void> {
    const state = connStatus === "connected" ? (snapshot?.state ?? "idle") : "stopped";
    const toolName = snapshot?.tool;
    const macros = this.getMacros();

    for (const instance of this.actions) {
      const slotIndex = slotAssignments.get(instance.id);
      if (slotIndex === undefined) continue;

      const config = getSlotConfig(state, slotIndex, toolName, macros);
      const imageData = `data:image/svg+xml,${encodeURIComponent(config.svg)}`;

      await instance.setImage(imageData);
      await instance.setTitle(config.title);
    }
  }
}
