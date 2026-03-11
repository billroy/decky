/**
 * Bridge HTTP client.
 *
 * Reads the bridge token fresh on every call (compatible with token rotation).
 * Base URL defaults to http://127.0.0.1:9130 or DECKY_BRIDGE_URL env var.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DECKY_DIR = process.env.DECKY_HOME ?? join(homedir(), ".decky");
const TOKEN_PATH = join(DECKY_DIR, "bridge-token");
export const DEFAULT_BASE_URL = process.env.DECKY_BRIDGE_URL ?? "http://127.0.0.1:9130";

export class BridgeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export class BridgeUnreachableError extends Error {
  constructor(public readonly cause_: unknown) {
    super("Bridge is not running or not reachable");
    this.name = "BridgeUnreachableError";
  }
}

function readToken(): string {
  try {
    // Warn if token file is world-readable
    const st = statSync(TOKEN_PATH);
    if ((st.mode & 0o004) !== 0) {
      process.stderr.write(
        `[decky-mcp] WARNING: ${TOKEN_PATH} is world-readable. Run: chmod 600 ${TOKEN_PATH}\n`,
      );
    }
    return readFileSync(TOKEN_PATH, "utf-8").trim();
  } catch {
    return "";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = readToken();
  const url = `${DEFAULT_BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-decky-token": token,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new BridgeUnreachableError(err);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) msg = errBody.error;
    } catch {
      // ignore parse failure
    }
    throw new BridgeError(res.status, msg);
  }

  return res.json() as Promise<T>;
}

export const bridge = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/** Probe the bridge — returns true if reachable, false otherwise. */
export async function probebridge(): Promise<boolean> {
  try {
    await bridge.get("/status");
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a bridge error into a human-readable MCP tool error string.
 */
export function formatBridgeError(err: unknown): string {
  if (err instanceof BridgeUnreachableError) {
    return (
      "Decky bridge is not running. Start it with: npm run dev (in the bridge/ directory), " +
      "or ./start.sh from the project root."
    );
  }
  if (err instanceof BridgeError) {
    if (err.status === 401) return "Unauthorized — bridge token mismatch. Restart the bridge.";
    if (err.status === 403)
      return "Forbidden — this endpoint requires DECKY_DEBUG=1 on the bridge.";
    return `Bridge returned error: ${err.message}`;
  }
  return `Unexpected error: ${String(err)}`;
}
