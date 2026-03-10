import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Request } from "express";

const DECKY_DIR = process.env.DECKY_HOME || join(homedir(), ".decky");
const TOKEN_PATH = join(DECKY_DIR, "bridge-token");

let cachedToken: string | null = null;

function ensureDeckyDir(): void {
  mkdirSync(DECKY_DIR, { recursive: true, mode: 0o700 });
}

function normalizeToken(raw: string): string {
  return raw.trim();
}

function createToken(): string {
  return randomBytes(32).toString("hex");
}

export function getBridgeToken(): string {
  const env = process.env.DECKY_AUTH_TOKEN;
  if (typeof env === "string" && env.trim().length >= 16) {
    cachedToken = normalizeToken(env);
    return cachedToken;
  }
  if (cachedToken) return cachedToken;

  ensureDeckyDir();
  if (existsSync(TOKEN_PATH)) {
    const existing = normalizeToken(readFileSync(TOKEN_PATH, "utf-8"));
    if (existing.length >= 16) {
      cachedToken = existing;
      return existing;
    }
  }

  const token = createToken();
  writeFileSync(TOKEN_PATH, `${token}\n`, { encoding: "utf-8", mode: 0o600 });
  cachedToken = token;
  return token;
}

export function readRequestToken(req: Request): string {
  const h = req.header("x-decky-token");
  return typeof h === "string" ? h.trim() : "";
}

export function redactActionForLog(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "text" && typeof v === "string") {
      out[k] = `[redacted:${v.length}]`;
      continue;
    }
    if (k === "macros" && Array.isArray(v)) {
      out[k] = v.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const m = entry as Record<string, unknown>;
        return {
          label: typeof m.label === "string" ? m.label : "",
          text: typeof m.text === "string" ? `[redacted:${m.text.length}]` : "",
          icon: typeof m.icon === "string" ? m.icon : undefined,
          targetApp: typeof m.targetApp === "string" ? m.targetApp : undefined,
          hasColors: !!(m.colors && typeof m.colors === "object"),
        };
      });
      continue;
    }
    out[k] = v;
  }
  return out;
}
