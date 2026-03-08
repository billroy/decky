/**
 * Approve action — sends "approve" to the bridge when pressed.
 *
 * Active (green ✓) when state is awaiting-approval.
 * Dimmed (gray) in all other states.
 */

import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
} from "@elgato/streamdeck";
import { type BridgeClient, type ConnectionStatus, type StateSnapshot } from "../bridge-client.js";

const ACTIVE_COLOR = "#22c55e";   // green
const INACTIVE_COLOR = "#4b5563"; // gray

function renderSVG(color: string, symbol: string): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${color}" />
    <text x="72" y="88" font-size="72" text-anchor="middle" fill="white">${symbol}</text>
  </svg>`;
}

let bridgeRef: BridgeClient | null = null;

export function setApproveClient(client: BridgeClient): void {
  bridgeRef = client;
}

@action({ UUID: "com.decky.controller.approve" })
export class ApproveAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubState?: () => void;

  override async onWillAppear(_ev: WillAppearEvent): Promise<void> {
    if (!bridgeRef) {
      await this.render("disconnected", null);
      return;
    }

    await this.render(bridgeRef.getConnectionStatus(), bridgeRef.getLastSnapshot());

    this.unsubConnection = bridgeRef.onConnectionChange((status) => {
      this.render(status, bridgeRef!.getLastSnapshot()).catch(() => {});
    });

    this.unsubState = bridgeRef.onStateChange((snapshot) => {
      this.render(bridgeRef!.getConnectionStatus(), snapshot).catch(() => {});
    });
  }

  override async onWillDisappear(_ev: WillDisappearEvent): Promise<void> {
    this.unsubConnection?.();
    this.unsubState?.();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    if (!bridgeRef) return;
    const snapshot = bridgeRef.getLastSnapshot();
    if (snapshot?.state === "awaiting-approval") {
      bridgeRef.sendAction("approve");
    }
  }

  private async render(connStatus: ConnectionStatus, snapshot: StateSnapshot | null): Promise<void> {
    const active = connStatus === "connected" && snapshot?.state === "awaiting-approval";
    const color = active ? ACTIVE_COLOR : INACTIVE_COLOR;
    const svg = renderSVG(color, "\u2713"); // ✓
    const imageData = `data:image/svg+xml,${encodeURIComponent(svg)}`;

    for (const instance of this.actions) {
      try {
        await instance.setImage(imageData);
        await instance.setTitle("");
      } catch {
        // SDK may throw if the action disappeared mid-render; safe to ignore.
      }
    }
  }
}
