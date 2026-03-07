/**
 * Deny action — sends "deny" to the bridge when pressed.
 *
 * Active (red ✗) when state is awaiting-approval.
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

const ACTIVE_COLOR = "#ef4444";   // red
const INACTIVE_COLOR = "#4b5563"; // gray

function renderSVG(color: string, symbol: string): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${color}" />
    <text x="72" y="88" font-size="72" text-anchor="middle" fill="white">${symbol}</text>
  </svg>`;
}

let bridgeRef: BridgeClient | null = null;

export function setDenyClient(client: BridgeClient): void {
  bridgeRef = client;
}

@action({ UUID: "com.decky.controller.deny" })
export class DenyAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubState?: () => void;

  override async onWillAppear(_ev: WillAppearEvent): Promise<void> {
    if (!bridgeRef) return;

    await this.render(bridgeRef.getConnectionStatus(), bridgeRef.getLastSnapshot());

    this.unsubConnection = bridgeRef.onConnectionChange(async (status) => {
      await this.render(status, bridgeRef!.getLastSnapshot());
    });

    this.unsubState = bridgeRef.onStateChange(async (snapshot) => {
      await this.render(bridgeRef!.getConnectionStatus(), snapshot);
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
      bridgeRef.sendAction("deny");
    }
  }

  private async render(connStatus: ConnectionStatus, snapshot: StateSnapshot | null): Promise<void> {
    const active = connStatus === "connected" && snapshot?.state === "awaiting-approval";
    const color = active ? ACTIVE_COLOR : INACTIVE_COLOR;
    const svg = renderSVG(color, "\u2717"); // ✗
    const imageData = `data:image/svg+xml,${encodeURIComponent(svg)}`;

    for (const instance of this.actions) {
      await instance.setImage(imageData);
      await instance.setTitle(active ? "Deny" : "");
    }
  }
}
