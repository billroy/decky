/**
 * Macro executor — Linux/X11 backend.
 *
 * Injects text into a target app via xclip + xdotool. Activates windows
 * by WM_CLASS, simulates keystrokes, and captures/restores focus.
 * Requires X11 session — Wayland is detected and rejected with a clear error.
 *
 * Architecture mirrors macro-exec-darwin.ts / macro-exec-win32.ts:
 *   - `xclip -selection clipboard` for clipboard (pipe stdin, like pbcopy/clip.exe)
 *   - `xdotool` for window activation, keystrokes, focus management
 *   - No native npm dependencies
 */

import { execFile } from "node:child_process";
import type { TargetApp } from "./config.js";

interface MacroExecutionOptions {
  targetApp?: TargetApp;
  submit?: boolean;
}

// ── Wayland detection ─────────────────────────────────────────────────────────

function isWayland(): boolean {
  const sessionType = process.env.XDG_SESSION_TYPE;
  if (sessionType === "wayland") return true;
  // Fallback: WAYLAND_DISPLAY is set on Wayland sessions (even with XWayland)
  if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) return true;
  return false;
}

function assertX11(): void {
  if (isWayland()) {
    throw new Error(
      "Text injection requires an X11 session. " +
      "Wayland was detected (XDG_SESSION_TYPE=wayland). " +
      "xdotool cannot activate windows or send keystrokes under Wayland.",
    );
  }
}

// ── App identification ────────────────────────────────────────────────────────

interface LinuxTargetAppSpec {
  wmClass: string;
  processName: string;
}

const TARGET_APP_SPECS: Record<TargetApp, LinuxTargetAppSpec> = {
  claude:   { wmClass: "claude",   processName: "claude" },
  codex:    { wmClass: "codex",    processName: "codex" },
  chatgpt:  { wmClass: "chatgpt",  processName: "chatgpt" },
  cursor:   { wmClass: "cursor",   processName: "cursor" },
  windsurf: { wmClass: "windsurf", processName: "windsurf" },
};

// ── Approval attempt logging (platform-agnostic pattern) ──────────────────────

type ApprovalTargetApp = "claude" | "codex";

interface ApprovalAttempt {
  timestamp: number;
  contextId: string | null;
  phase: "approve" | "dismiss";
  strategy: string;
  targetApp: ApprovalTargetApp;
  hostApp: TargetApp | "frontmost";
  success: boolean;
  detail?: string;
  error?: string;
}

type ApprovalAttemptLogger = (attempt: ApprovalAttempt) => void;

let approvalAttemptLogger: ApprovalAttemptLogger | null = null;
const approvalAttemptContextStack: string[] = [];

function currentAttemptContextId(): string | null {
  const idx = approvalAttemptContextStack.length - 1;
  return idx >= 0 ? approvalAttemptContextStack[idx] : null;
}

function reportApprovalAttempt(attempt: Omit<ApprovalAttempt, "timestamp" | "contextId">): void {
  approvalAttemptLogger?.({
    timestamp: Date.now(),
    contextId: currentAttemptContextId(),
    ...attempt,
  });
}

export function setApprovalAttemptLogger(logger: ApprovalAttemptLogger | null): void {
  approvalAttemptLogger = logger;
}

export async function withApprovalAttemptContext<T>(
  actionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  approvalAttemptContextStack.push(actionId);
  try {
    return await fn();
  } finally {
    approvalAttemptContextStack.pop();
  }
}

// ── Shell helpers ─────────────────────────────────────────────────────────────

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve((stdout ?? "").trim());
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Focus capture / restore ───────────────────────────────────────────────────

interface FocusSnapshot {
  windowId: string;
  windowName: string;
  pid: string;
}

async function getActiveWindow(): Promise<FocusSnapshot | null> {
  try {
    const wid = await run("xdotool", ["getactivewindow"]);
    if (!wid) return null;
    let windowName = "";
    let pid = "";
    try { windowName = await run("xdotool", ["getwindowname", wid]); } catch { /* best-effort */ }
    try { pid = await run("xdotool", ["getwindowpid", wid]); } catch { /* best-effort */ }
    return { windowId: wid, windowName, pid };
  } catch {
    return null;
  }
}

// ── Activate target app ───────────────────────────────────────────────────────

/**
 * Find and activate a window by WM_CLASS. Falls back to window name search.
 * Returns the window ID of the activated window, or null if not found.
 */
async function activateByClass(targetApp: TargetApp): Promise<string | null> {
  const spec = TARGET_APP_SPECS[targetApp];

  // Strategy 1: search by WM_CLASS (case-insensitive by default)
  try {
    const wid = await run("xdotool", ["search", "--class", spec.wmClass]);
    if (wid) {
      // xdotool search may return multiple window IDs, take the first
      const firstWid = wid.split("\n")[0].trim();
      await run("xdotool", ["windowactivate", "--sync", firstWid]);
      return firstWid;
    }
  } catch { /* fall through */ }

  // Strategy 2: search by window name
  try {
    const wid = await run("xdotool", ["search", "--name", spec.wmClass]);
    if (wid) {
      const firstWid = wid.split("\n")[0].trim();
      await run("xdotool", ["windowactivate", "--sync", firstWid]);
      return firstWid;
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * Bring the target app to the foreground without interacting with it.
 */
export async function surfaceTargetApp(targetApp: TargetApp): Promise<void> {
  assertX11();
  const wid = await activateByClass(targetApp);
  if (!wid) {
    console.warn(`[macro-linux] could not find window for ${targetApp}`);
  }
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = execFile("xclip", ["-selection", "clipboard"], (err) => {
      if (err) {
        console.error("[macro-linux] xclip failed:", err.message);
        reject(err);
        return;
      }
      resolve();
    });
    proc.stdin?.write(text);
    proc.stdin?.end();
  });
}

// ── Text injection (executeMacro) ─────────────────────────────────────────────

/**
 * Inject text into the selected app by copying to clipboard and pasting.
 *
 * Quick-focus-steal: captures the active window before activating the target,
 * then restores it after paste+submit.
 */
export async function executeMacro(text: string, options: MacroExecutionOptions = {}): Promise<void> {
  assertX11();
  const targetApp = options.targetApp ?? "claude";
  const submit = options.submit !== false;
  const spec = TARGET_APP_SPECS[targetApp];

  // Capture the currently focused window before we steal focus.
  const snapshot = await getActiveWindow();

  // Copy text to clipboard.
  await copyToClipboard(text);

  // Activate target app.
  const targetWid = await activateByClass(targetApp);
  if (!targetWid) {
    throw new Error(`Could not find ${spec.wmClass} window to activate`);
  }

  // Paste (Ctrl+V) — small delay for window to stabilize.
  await sleep(300);
  await run("xdotool", ["key", "ctrl+v"]);

  // Submit (Enter) if requested.
  if (submit) {
    await sleep(100);
    await run("xdotool", ["key", "Return"]);
  }

  // Determine if we need to restore focus.
  const needsRestore = snapshot != null && snapshot.windowId !== targetWid;

  console.log(`[macro-linux] injected target=${targetApp}: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`);

  // Restore focus to previous window.
  if (needsRestore) {
    const restoreDelay = targetApp === "claude" ? 300 : 1500;
    await sleep(restoreDelay);
    try {
      await run("xdotool", ["windowactivate", "--sync", snapshot!.windowId]);
      console.log(
        `[macro-linux] restored focus to window ${snapshot!.windowId}` +
          (snapshot!.windowName ? ` "${snapshot!.windowName}"` : ""),
      );
    } catch (err) {
      // Best-effort restoration — don't fail the macro.
      console.warn("[macro-linux] focus restore failed:", err);
    }
  }
}

// ── Approval automation ───────────────────────────────────────────────────────

/**
 * Send a keystroke to the target app via xdotool.
 */
async function sendKeystroke(targetApp: TargetApp, key: string): Promise<void> {
  await activateByClass(targetApp);
  await sleep(150);
  await run("xdotool", ["key", key]);
}

async function approveInTargetApp(targetApp: ApprovalTargetApp): Promise<void> {
  assertX11();

  // Keystroke approach — activate and press Enter.
  // No AT-SPI button clicking (unreliable for Electron apps).
  if (targetApp === "codex") {
    try {
      await sendKeystroke("codex", "Return");
      reportApprovalAttempt({
        phase: "approve",
        strategy: "keystroke:return",
        targetApp,
        hostApp: "codex",
        success: true,
      });
      return;
    } catch (err) {
      reportApprovalAttempt({
        phase: "approve",
        strategy: "keystroke:return",
        targetApp,
        hostApp: "codex",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await sendKeystroke("cursor", "Return");
    reportApprovalAttempt({
      phase: "approve",
      strategy: "keystroke:return",
      targetApp,
      hostApp: "cursor",
      success: true,
    });
    return;
  }

  await sendKeystroke(targetApp, "Return");
  reportApprovalAttempt({
    phase: "approve",
    strategy: "keystroke:return",
    targetApp,
    hostApp: targetApp,
    success: true,
  });
}

export function approveOnceInClaude(): Promise<void> {
  return approveInTargetApp("claude");
}

async function dismissApprovalInTargetApp(targetApp: ApprovalTargetApp): Promise<void> {
  assertX11();

  if (targetApp === "codex") {
    try {
      await sendKeystroke("codex", "Escape");
      reportApprovalAttempt({
        phase: "dismiss",
        strategy: "keystroke:escape",
        targetApp,
        hostApp: "codex",
        success: true,
      });
      return;
    } catch (err) {
      reportApprovalAttempt({
        phase: "dismiss",
        strategy: "keystroke:escape",
        targetApp,
        hostApp: "codex",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await sendKeystroke("cursor", "Escape");
    reportApprovalAttempt({
      phase: "dismiss",
      strategy: "keystroke:escape",
      targetApp,
      hostApp: "cursor",
      success: true,
    });
    return;
  }

  await sendKeystroke(targetApp, "Escape");
  reportApprovalAttempt({
    phase: "dismiss",
    strategy: "keystroke:escape",
    targetApp,
    hostApp: targetApp,
    success: true,
  });
}

export function dismissClaudeApproval(): Promise<void> {
  return dismissApprovalInTargetApp("claude");
}

// ── Dictation ─────────────────────────────────────────────────────────────────

export function startDictationForClaude(): Promise<void> {
  return Promise.reject(
    new Error("Dictation is not supported on Linux. No standard dictation API is available."),
  );
}
