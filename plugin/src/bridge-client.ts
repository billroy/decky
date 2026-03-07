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

export type ConnectionStatus = "connected" | "disconnected" | "connecting";

type StateChangeListener = (snapshot: StateSnapshot) => void;
type ConnectionListener = (status: ConnectionStatus) => void;

export class BridgeClient {
  private socket: Socket | null = null;
  private connectionStatus: ConnectionStatus = "disconnected";
  private lastSnapshot: StateSnapshot | null = null;
  private stateListeners: StateChangeListener[] = [];
  private connectionListeners: ConnectionListener[] = [];

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
        listener(snapshot);
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
        listener(status);
      }
    }
  }
}
