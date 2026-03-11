/**
 * Approval gate — file-based signaling between bridge and hook scripts.
 *
 * Flow:
 *   1. Hook script (pre-tool-use.sh) clears any stale gate file, POSTs to bridge, then polls.
 *   2. Bridge writes "approve", "deny", or "cancel" when a StreamDeck action is received.
 *   3. Hook script reads the result, deletes the file, and exits with the appropriate code.
 */

import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { portableRenameSync } from "./fs-compat.js";
import { join } from "node:path";
import { homedir } from "node:os";

export type ApprovalResult = "approve" | "deny" | "cancel";

const DECKY_DIR = process.env.DECKY_HOME || join(homedir(), ".decky");
const GATE_FILE = join(DECKY_DIR, "approval-gate");

/** Ensure ~/.decky/ directory exists. */
function ensureDir(): void {
  mkdirSync(DECKY_DIR, { recursive: true, mode: 0o700 });
}

/**
 * Write the approval result so the polling hook script can read it.
 * @deprecated Gate flow is legacy. Default is mirror. Set DECKY_APPROVAL_FLOW=gate to use.
 */
export function writeGateFile(result: ApprovalResult, nonce?: string): void {
  ensureDir();
  const payload = nonce ? `${nonce}:${result}` : result;
  const tmp = `${GATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, payload, { encoding: "utf-8", mode: 0o600 });
  portableRenameSync(tmp, GATE_FILE);
}

/**
 * Remove the gate file (idempotent).
 * @deprecated Gate flow is legacy. Default is mirror. Set DECKY_APPROVAL_FLOW=gate to use.
 */
export function clearGateFile(): void {
  try {
    unlinkSync(GATE_FILE);
  } catch {
    // File already gone — that's fine.
  }
}

/** Check whether a gate file currently exists. */
export function gateFileExists(): boolean {
  return existsSync(GATE_FILE);
}

/** Exposed for testing / configuration. */
export const GATE_FILE_PATH = GATE_FILE;
export const DECKY_DIR_PATH = DECKY_DIR;
