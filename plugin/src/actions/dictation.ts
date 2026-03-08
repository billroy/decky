import {
  action,
  SingletonAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { type BridgeClient, type ConnectionStatus } from "../bridge-client.js";

const ACTIVE_COLOR = "#2563eb";
const INACTIVE_COLOR = "#334155";

function renderSVG(color: string): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${color}" />
    <circle cx="72" cy="54" r="16" fill="white"/>
    <rect x="64" y="68" width="16" height="28" rx="8" fill="white"/>
    <rect x="52" y="102" width="40" height="8" rx="4" fill="white"/>
  </svg>`;
}

let bridgeRef: BridgeClient | null = null;

export function setDictationClient(client: BridgeClient): void {
  bridgeRef = client;
}

@action({ UUID: "com.decky.controller.startDictationForClaude" })
export class DictationAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubConfig?: () => void;

  override async onWillAppear(_ev: WillAppearEvent): Promise<void> {
    if (!bridgeRef) {
      await this.render("disconnected");
      return;
    }
    await this.render(bridgeRef.getConnectionStatus());
    this.unsubConnection = bridgeRef.onConnectionChange((status) => {
      this.render(status).catch(() => {});
    });
    this.unsubConfig = bridgeRef.onConfigChange(() => {
      this.render(bridgeRef!.getConnectionStatus()).catch(() => {});
    });
  }

  override async onWillDisappear(_ev: WillDisappearEvent): Promise<void> {
    this.unsubConnection?.();
    this.unsubConfig?.();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    if (!bridgeRef || bridgeRef.getConnectionStatus() !== "connected") return;
    const cfg = bridgeRef.getLastConfig();
    if (cfg?.enableDictation === false) return;
    bridgeRef.sendAction("startDictationForClaude");
  }

  private async render(conn: ConnectionStatus): Promise<void> {
    const cfg = bridgeRef?.getLastConfig();
    const active = conn === "connected" && cfg?.enableDictation !== false;
    const svg = renderSVG(active ? ACTIVE_COLOR : INACTIVE_COLOR);
    const image = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    for (const instance of this.actions) {
      try {
        await instance.setImage(image);
        await instance.setTitle("");
      } catch {
        // ignore action disposal races
      }
    }
  }
}
