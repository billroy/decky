/**
 * Status action — shows bridge connection status on a StreamDeck key.
 *
 * Green circle = connected to bridge
 * Red circle = disconnected
 * Amber circle = connecting
 *
 * Also displays the current Claude Code state as the button title.
 */

import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
} from "@elgato/streamdeck";
import { type BridgeClient, type ConnectionStatus, type StateSnapshot } from "../bridge-client.js";

const COLORS: Record<ConnectionStatus, string> = {
  connected: "#22c55e",    // green
  disconnected: "#ef4444", // red
  connecting: "#f59e0b",   // amber
};

const STATE_LABELS: Record<string, string> = {
  idle: "Idle",
  thinking: "Thinking",
  "awaiting-approval": "Approve?",
  "tool-executing": "Running",
  stopped: "Stopped",
};

function statusSVG(color: string): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <circle cx="72" cy="72" r="50" fill="${color}" />
  </svg>`;
}

let bridgeClientRef: BridgeClient | null = null;

/** Inject the shared BridgeClient before StreamDeck.connect() */
export function setBridgeClient(client: BridgeClient): void {
  bridgeClientRef = client;
}

@action({ UUID: "com.decky.controller.status" })
export class StatusAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubState?: () => void;

  override async onWillAppear(_ev: WillAppearEvent): Promise<void> {
    if (!bridgeClientRef) return;

    // Render current status immediately
    await this.updateAll(bridgeClientRef.getConnectionStatus(), bridgeClientRef.getLastSnapshot());

    // Subscribe to changes
    this.unsubConnection = bridgeClientRef.onConnectionChange((status) => {
      this.updateAll(status, bridgeClientRef!.getLastSnapshot()).catch(() => {});
    });

    this.unsubState = bridgeClientRef.onStateChange((snapshot) => {
      this.updateAll(bridgeClientRef!.getConnectionStatus(), snapshot).catch(() => {});
    });
  }

  override async onWillDisappear(_ev: WillDisappearEvent): Promise<void> {
    this.unsubConnection?.();
    this.unsubState?.();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    // Future: could cycle through info, or trigger reconnect
    console.log("[status] key pressed");
  }

  private async updateAll(connStatus: ConnectionStatus, snapshot: StateSnapshot | null): Promise<void> {
    const color = COLORS[connStatus];
    const svg = statusSVG(color);
    const imageData = `data:image/svg+xml,${encodeURIComponent(svg)}`;

    let title: string;
    if (connStatus !== "connected") {
      title = connStatus === "connecting" ? "..." : "Offline";
    } else {
      title = snapshot ? (STATE_LABELS[snapshot.state] ?? snapshot.state) : "Connected";
    }

    // Update all visible instances of this action
    for (const instance of this.actions) {
      try {
        await instance.setImage(imageData);
        await instance.setTitle(title);
      } catch {
        // SDK may throw if the action disappeared mid-render; safe to ignore.
      }
    }
  }
}
