import {
  action,
  SingletonAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { type BridgeClient, type ConnectionStatus, type StateSnapshot } from "../bridge-client.js";

const ACTIVE_COLOR = "#16a34a";
const INACTIVE_COLOR = "#4b5563";

function renderSVG(color: string): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${color}" />
    <text x="72" y="62" font-size="28" text-anchor="middle" fill="white">APPROVE</text>
    <text x="72" y="102" font-size="24" text-anchor="middle" fill="white">ONCE</text>
  </svg>`;
}

let bridgeRef: BridgeClient | null = null;

export function setApproveOnceClient(client: BridgeClient): void {
  bridgeRef = client;
}

@action({ UUID: "com.decky.controller.approveOnceInClaude" })
export class ApproveOnceAction extends SingletonAction {
  private unsubConnection?: () => void;
  private unsubState?: () => void;
  private unsubConfig?: () => void;

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
    this.unsubConfig = bridgeRef.onConfigChange(() => {
      this.render(bridgeRef!.getConnectionStatus(), bridgeRef!.getLastSnapshot()).catch(() => {});
    });
  }

  override async onWillDisappear(_ev: WillDisappearEvent): Promise<void> {
    this.unsubConnection?.();
    this.unsubState?.();
    this.unsubConfig?.();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    if (!bridgeRef) return;
    const cfg = bridgeRef.getLastConfig();
    if (cfg?.enableApproveOnce === false) return;
    const snapshot = bridgeRef.getLastSnapshot();
    if (snapshot?.state === "awaiting-approval") {
      bridgeRef.sendAction("approveOnceInClaude");
    }
  }

  private async render(conn: ConnectionStatus, snapshot: StateSnapshot | null): Promise<void> {
    const cfg = bridgeRef?.getLastConfig();
    const enabled = cfg?.enableApproveOnce !== false;
    const active = enabled && conn === "connected" && snapshot?.state === "awaiting-approval";
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
