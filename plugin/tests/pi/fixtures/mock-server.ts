import { WebSocketServer, type WebSocket } from "ws";

export interface PiEnvelope {
  event: string;
  action?: string;
  context?: string;
  payload?: Record<string, unknown>;
  uuid?: string;
}

export class MockStreamDeckServer {
  private wss: WebSocketServer;
  private sockets = new Set<WebSocket>();
  private messages: PiEnvelope[] = [];

  private constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.wss.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("message", (raw) => {
        try {
          const parsed = JSON.parse(String(raw)) as PiEnvelope;
          this.messages.push(parsed);
        } catch {
          // Ignore malformed messages from browser.
        }
      });
      socket.on("close", () => {
        this.sockets.delete(socket);
      });
    });
  }

  static async start(): Promise<MockStreamDeckServer> {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => {
      wss.once("listening", () => resolve());
    });
    return new MockStreamDeckServer(wss);
  }

  get port(): number {
    const addr = this.wss.address();
    if (!addr || typeof addr === "string") throw new Error("Mock server has no numeric port");
    return addr.port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        // no-op
      }
    }
    this.sockets.clear();
    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  clearMessages(): void {
    this.messages = [];
  }

  getMessages(): PiEnvelope[] {
    return [...this.messages];
  }

  async waitForEvent(
    event: string,
    predicate?: (msg: PiEnvelope) => boolean,
    timeoutMs = 4000,
  ): Promise<PiEnvelope> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = this.messages.find((msg) => msg.event === event && (!predicate || predicate(msg)));
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Timeout waiting for event ${event}`);
  }

  async waitForPayloadType(type: string, timeoutMs = 4000): Promise<Record<string, unknown>> {
    const evt = await this.waitForEvent(
      "sendToPlugin",
      (msg) => msg.payload?.type === type,
      timeoutMs,
    );
    return (evt.payload ?? {}) as Record<string, unknown>;
  }

  sendToPI(payload: Record<string, unknown>): void {
    const envelope = JSON.stringify({
      event: "sendToPropertyInspector",
      payload,
    });
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(envelope);
      }
    }
  }
}
