/**
 * Bridge client — connects to the Decky bridge server via Socket.io.
 *
 * Manages connection lifecycle and exposes state change events.
 * Designed to be a singleton shared across all StreamDeck actions.
 */

import { io, type Socket } from "socket.io-client";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface StateSnapshot {
  state: string;
  previousState: string | null;
  tool: string | null;
  lastEvent: string | null;
  timestamp: number;
  approval?: {
    pending: number;
    position: number;
    targetApp: "claude" | "codex";
    flow: "gate" | "mirror";
    requestId: string;
  } | null;
}

export interface ColorOverrides {
  bg?: string;
  text?: string;
  icon?: string;
}

export type WidgetKind = "bridge-status";
export type WidgetRefreshMode = "onClick" | "interval";

export interface WidgetDef {
  kind: WidgetKind;
  refreshMode?: WidgetRefreshMode;
  intervalMinutes?: number;
}

export type TargetApp = "claude" | "codex" | "chatgpt" | "cursor" | "windsurf";
export type Theme =
  | "light"
  | "dark"
  | "dracula"
  | "monokai"
  | "solarized-dark"
  | "solarized-light"
  | "nord"
  | "github-dark"
  | "candy-cane"
  | "gradient-blue"
  | "wormhole"
  | "rainbow"
  | "random";

export interface MacroDef {
  label: string;
  text: string;
  icon?: string;
  fontSize?: number;
  colors?: ColorOverrides;
  targetApp?: TargetApp;
  submit?: boolean;
  type?:
    | "macro"
    | "widget"
    | "approve"
    | "deny"
    | "cancel"
    | "restart"
    | "openConfig"
    | "approveOnceInClaude"
    | "startDictationForClaude";
  widget?: WidgetDef;
}

export interface DeckyConfig {
  macros: MacroDef[];
  approvalTimeout: number;
  theme: Theme;
  themeSeed?: number;
  editor?: string;
  colors?: ColorOverrides;
  defaultTargetApp: TargetApp;
  showTargetBadge: boolean;
  enableApproveOnce?: boolean;
  enableDictation?: boolean;
}

export type ConnectionStatus = "connected" | "disconnected" | "connecting";

type StateChangeListener = (snapshot: StateSnapshot) => void;
type ConnectionListener = (status: ConnectionStatus) => void;
type ConfigListener = (config: DeckyConfig) => void;
type BridgeEventListener = (event: string, payload: unknown) => void;

function createActionId(prefix = "sd"): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

export class BridgeClient {
  private socket: Socket | null = null;
  private connectionStatus: ConnectionStatus = "disconnected";
  private lastSnapshot: StateSnapshot | null = null;
  private stateListeners: StateChangeListener[] = [];
  private connectionListeners: ConnectionListener[] = [];
  private configListeners: ConfigListener[] = [];
  private bridgeEventListeners: BridgeEventListener[] = [];
  private lastConfig: DeckyConfig | null = null;
  private authToken: string = "";
  private serverReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private url: string = "http://localhost:9130") {
    this.authToken = this.loadAuthToken();
  }

  private loadAuthToken(): string {
    const envToken = process.env.DECKY_AUTH_TOKEN;
    if (typeof envToken === "string" && envToken.trim().length >= 16) return envToken.trim();
    const deckyHome = process.env.DECKY_HOME || join(homedir(), ".decky");
    const tokenPath = join(deckyHome, "bridge-token");
    if (!existsSync(tokenPath)) return "";
    return readFileSync(tokenPath, "utf-8").trim();
  }

  connect(): void {
    if (this.socket) return;

    this.refreshAuthToken();
    this.setConnectionStatus("connecting");

    this.socket = io(this.url, {
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 5000,
      auth: (cb) => {
        this.refreshAuthToken();
        cb({ token: this.authToken });
      },
    });

    this.socket.on("connect", () => {
      console.log("[bridge] connected");
      this.clearServerReconnectTimer();
      this.setConnectionStatus("connected");
    });

    this.socket.on("disconnect", (reason) => {
      console.log(`[bridge] disconnected (${reason})`);
      this.setConnectionStatus("disconnected");
      // Server-side disconnects (for example Unauthorized) do not auto-reconnect.
      // Retry manually so startup races around bridge-token creation can recover.
      if (reason === "io server disconnect") {
        this.scheduleServerReconnect(1000);
      }
    });

    this.socket.on("connect_error", (error) => {
      if (error instanceof Error) {
        console.log(`[bridge] connect_error: ${error.message}`);
      }
      this.setConnectionStatus("disconnected");
    });

    this.socket.on("error", (payload: unknown) => {
      const payloadObj = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
      const message = payloadObj && typeof payloadObj.error === "string" ? payloadObj.error : "";
      if (message) {
        console.log(`[bridge] socket error: ${message}`);
      }
      for (const listener of this.bridgeEventListeners) {
        try { listener("error", payload); } catch { /* listener errors must not crash the client */ }
      }
      if (message.toLowerCase().includes("unauthorized")) {
        this.scheduleServerReconnect(1000);
      }
    });

    this.socket.on("stateChange", (snapshot: StateSnapshot) => {
      console.log(`[bridge] state: ${snapshot.state} (event=${snapshot.lastEvent})`);
      this.lastSnapshot = snapshot;
      for (const listener of this.stateListeners) {
        try { listener(snapshot); } catch { /* listener errors must not crash the client */ }
      }
    });

    this.socket.on("configUpdate", (config: DeckyConfig) => {
      console.log(`[bridge] config: ${config.macros.length} macros`);
      this.lastConfig = config;
      for (const listener of this.configListeners) {
        try { listener(config); } catch { /* listener errors must not crash the client */ }
      }
    });

    this.socket.on("updateConfigAck", (payload: unknown) => {
      // Some plugin flows depend on config freshness immediately after Apply.
      // Treat ack.config as authoritative if present so UI/key render stays in sync
      // even if a separate configUpdate event is delayed or dropped.
      if (payload && typeof payload === "object") {
        const maybeConfig = (payload as Record<string, unknown>).config;
        if (maybeConfig && typeof maybeConfig === "object") {
          const config = maybeConfig as DeckyConfig;
          this.lastConfig = config;
          for (const listener of this.configListeners) {
            try { listener(config); } catch { /* listener errors must not crash the client */ }
          }
        }
      }
      for (const listener of this.bridgeEventListeners) {
        try { listener("updateConfigAck", payload); } catch { /* listener errors must not crash the client */ }
      }
    });

    this.socket.on("updateConfigError", (payload: unknown) => {
      for (const listener of this.bridgeEventListeners) {
        try { listener("updateConfigError", payload); } catch { /* listener errors must not crash the client */ }
      }
    });
  }

  disconnect(): void {
    this.clearServerReconnectTimer();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.setConnectionStatus("disconnected");
    }
  }

  sendAction(action: string, data?: Record<string, unknown>): string | null {
    const providedActionId =
      typeof data?.actionId === "string" && data.actionId.trim().length > 0
        ? data.actionId.trim()
        : null;
    const actionId = providedActionId ?? createActionId();
    if (this.socket?.connected) {
      console.log(`[bridge] sendAction action=${action} actionId=${actionId}`);
      this.socket.emit("action", { action, actionId, ...data });
      return actionId;
    }
    return null;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  getLastSnapshot(): StateSnapshot | null {
    return this.lastSnapshot;
  }

  onStateChange(listener: StateChangeListener): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  getLastConfig(): DeckyConfig | null {
    return this.lastConfig;
  }

  onConfigChange(listener: ConfigListener): () => void {
    this.configListeners.push(listener);
    return () => {
      this.configListeners = this.configListeners.filter((l) => l !== listener);
    };
  }

  onBridgeEvent(listener: BridgeEventListener): () => void {
    this.bridgeEventListeners.push(listener);
    return () => {
      this.bridgeEventListeners = this.bridgeEventListeners.filter((l) => l !== listener);
    };
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.push(listener);
    return () => {
      this.connectionListeners = this.connectionListeners.filter((l) => l !== listener);
    };
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (status !== this.connectionStatus) {
      this.connectionStatus = status;
      for (const listener of this.connectionListeners) {
        try { listener(status); } catch { /* listener errors must not crash the client */ }
      }
    }
  }

  private refreshAuthToken(): void {
    this.authToken = this.loadAuthToken();
  }

  private clearServerReconnectTimer(): void {
    if (!this.serverReconnectTimer) return;
    clearTimeout(this.serverReconnectTimer);
    this.serverReconnectTimer = null;
  }

  private scheduleServerReconnect(delayMs: number): void {
    if (!this.socket || this.serverReconnectTimer) return;
    this.serverReconnectTimer = setTimeout(() => {
      this.serverReconnectTimer = null;
      if (!this.socket) return;
      this.refreshAuthToken();
      this.setConnectionStatus("connecting");
      this.socket.connect();
    }, delayMs);
  }
}
