/**
 * Bridge client — connects to the Decky bridge server via Socket.io.
 *
 * Manages connection lifecycle and exposes state change events.
 * Designed to be a singleton shared across all StreamDeck actions.
 */

import { io, type Socket } from "socket.io-client";

export interface StateSnapshot {
  state: string;
  previousState: string | null;
  tool: string | null;
  lastEvent: string | null;
  timestamp: number;
}

export interface MacroDef {
  label: string;
  text: string;
  icon?: string;
}

export interface DeckyConfig {
  macros: MacroDef[];
  approvalTimeout: number;
  theme: "light" | "dark";
  editor?: string;
}

export type ConnectionStatus = "connected" | "disconnected" | "connecting";

type StateChangeListener = (snapshot: StateSnapshot) => void;
type ConnectionListener = (status: ConnectionStatus) => void;
type ConfigListener = (config: DeckyConfig) => void;

export class BridgeClient {
  private socket: Socket | null = null;
  private connectionStatus: ConnectionStatus = "disconnected";
  private lastSnapshot: StateSnapshot | null = null;
  private stateListeners: StateChangeListener[] = [];
  private connectionListeners: ConnectionListener[] = [];
  private configListeners: ConfigListener[] = [];
  private lastConfig: DeckyConfig | null = null;

  constructor(private url: string = "http://localhost:9130") {}

  connect(): void {
    if (this.socket) return;

    this.setConnectionStatus("connecting");

    this.socket = io(this.url, {
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 5000,
    });

    this.socket.on("connect", () => {
      console.log("[bridge] connected");
      this.setConnectionStatus("connected");
    });

    this.socket.on("disconnect", () => {
      console.log("[bridge] disconnected");
      this.setConnectionStatus("disconnected");
    });

    this.socket.on("connect_error", () => {
      this.setConnectionStatus("disconnected");
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
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.setConnectionStatus("disconnected");
    }
  }

  sendAction(action: string, data?: Record<string, unknown>): void {
    if (this.socket?.connected) {
      this.socket.emit("action", { action, ...data });
    }
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
}
