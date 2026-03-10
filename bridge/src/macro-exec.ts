/**
 * Macro executor — injects text into a target macOS app via AppleScript.
 *
 * Strategy: copy text to clipboard, activate Claude, paste with Cmd+V.
 * This is more reliable than keystroke-by-keystroke injection and works
 * regardless of special characters in the macro text.
 */

import { execFile } from "node:child_process";
import type { TargetApp } from "./config.js";

interface MacroExecutionOptions {
  targetApp?: TargetApp;
  submit?: boolean;
}

interface TargetAppSpec {
  appName: string;
  bundleId?: string;
}

const TARGET_APP_SPECS: Record<TargetApp, TargetAppSpec> = {
  claude: { appName: "Claude", bundleId: "com.anthropic.claudefordesktop" },
  codex: { appName: "Codex", bundleId: "com.openai.codex" },
  chatgpt: { appName: "ChatGPT", bundleId: "com.openai.chat" },
  cursor: { appName: "Cursor", bundleId: "com.todesktop.230313mzl4w4u92" },
  windsurf: { appName: "Windsurf", bundleId: "com.exafunction.windsurf" },
};

function activationScriptFor(targetApp: TargetApp): string {
  const spec = TARGET_APP_SPECS[targetApp];
  if (spec.bundleId) {
    return `
      try
        tell application id "${spec.bundleId}" to activate
      on error
        tell application "${spec.appName}" to activate
      end try
    `;
  }
  return `tell application "${spec.appName}" to activate`;
}

/**
 * Bring the target app to the foreground without clicking any buttons.
 * Used to surface the app whose approval request is active on the deck.
 */
export async function surfaceTargetApp(targetApp: TargetApp): Promise<void> {
  const script = activationScriptFor(targetApp);
  await runAppleScript(script);
}

/**
 * Re-activate an app by bundle ID. Best-effort — errors are silently ignored
 * so that macro execution still resolves even if focus restoration fails.
 */
async function reactivateApp(bundleId: string): Promise<void> {
  const script = `
    try
      tell application id "${bundleId}" to activate
    end try
  `;
  try {
    await runAppleScript(script);
  } catch {
    // Best-effort — don't propagate.
  }
}

/**
 * Inject text into the selected app by copying to clipboard and pasting.
 *
 * Quick-focus-steal: captures the frontmost app before activating the target,
 * then restores it after paste+submit so the user's window isn't left behind.
 *
 * Returns a promise that resolves when the AppleScript completes.
 */
export async function executeMacro(text: string, options: MacroExecutionOptions = {}): Promise<void> {
  const targetApp = options.targetApp ?? "claude";
  const submit = options.submit !== false;
  const activation = activationScriptFor(targetApp);

  // Capture the currently focused app *before* we steal focus.
  const previousBundleId = await getFrontmostBundleId();

  // Use pbcopy + AppleScript for reliable injection:
  // 1. Copy text to clipboard via pbcopy (handles all characters safely)
  // 2. Activate target app
  // 3. Paste with Cmd+V
  // 4. Press Return to send
  const script = `
    ${activation}
    delay 0.2
    tell application "System Events"
      keystroke "v" using command down
      ${submit ? `delay 0.1
      keystroke return` : ""}
    end tell
  `;

  await new Promise<void>((resolve, reject) => {
    // First, copy text to clipboard
    const pbcopy = execFile("pbcopy", (err) => {
      if (err) {
        console.error("[macro] pbcopy failed:", err.message);
        reject(err);
        return;
      }

      // Then run AppleScript to paste
      execFile("osascript", ["-e", script], (asErr) => {
        if (asErr) {
          console.error("[macro] AppleScript failed:", asErr.message);
          reject(asErr);
          return;
        }
        console.log(
          `[macro] injected target=${targetApp}: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`
        );
        resolve();
      });
    });

    pbcopy.stdin?.write(text);
    pbcopy.stdin?.end();
  });

  // Restore focus to the app the user was in before we stole it.
  // Skip if we were already in the target app (no steal happened).
  const targetBundleId = TARGET_APP_SPECS[targetApp]?.bundleId;
  if (previousBundleId && previousBundleId !== targetBundleId) {
    // Small delay so the paste + submit lands before we switch away.
    await new Promise((r) => setTimeout(r, 150));
    await reactivateApp(previousBundleId);
    console.log(`[macro] restored focus to ${previousBundleId}`);
  }
}

export function approveOnceInClaude(): Promise<void> {
  return approveInTargetApp("claude");
}

export type ApprovalTargetApp = "claude" | "codex";

export interface ApprovalAttempt {
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

const CODEX_BUNDLE_ID = "com.openai.codex";
const CURSOR_BUNDLE_ID = "com.todesktop.230313mzl4w4u92";
const CODEX_APPROVE_BUTTON_LABELS = [
  "Yes",
  "Allow",
  "Approve",
  "Continue",
  "Run",
  "OK",
] as const;
const CODEX_DISMISS_BUTTON_LABELS = [
  "Reject",
  "Deny",
  "Cancel",
  "Dismiss",
  "Decline",
  "No",
  "Don't allow",
] as const;

function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (asErr, stdout) => {
      if (asErr) return reject(asErr);
      resolve((stdout ?? "").trim());
    });
  });
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function getFrontmostBundleId(): Promise<string | null> {
  const script = `
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      return bundle identifier of frontApp
    end tell
  `;
  try {
    const id = await runAppleScript(script);
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function runFrontmostSystemKeystroke(keystrokeScript: string): Promise<void> {
  const script = `
    tell application "System Events"
      ${keystrokeScript}
    end tell
  `;
  return runAppleScript(script).then(() => undefined);
}

function runSystemKeystroke(targetApp: TargetApp, keystrokeScript: string): Promise<void> {
  const activation = activationScriptFor(targetApp);
  const script = `
    ${activation}
    delay 0.15
    tell application "System Events"
      ${keystrokeScript}
    end tell
  `;
  return runAppleScript(script).then(() => undefined);
}

async function clickApprovalButtonInTargetApp(
  phase: "approve" | "dismiss",
  approvalTarget: ApprovalTargetApp,
  hostApp: TargetApp,
  labels: readonly string[],
  activate: boolean,
  roleHint: "default" | "cancel" | "none" = "none",
): Promise<boolean> {
  const targetName = TARGET_APP_SPECS[hostApp].appName;
  const activation = activate ? `${activationScriptFor(hostApp)}\n    delay 0.1` : "";
  const labelList = labels.map(appleScriptString).join(", ");
  const roleScript =
    roleHint === "default"
      ? `
          try
            click (first button of front window whose subrole is "AXDefaultButton")
            return "clicked"
          end try
          try
            click (first button of sheet 1 of front window whose subrole is "AXDefaultButton")
            return "clicked"
          end try
          try
            click (first button of (entire contents of front window) whose role is "AXButton" and subrole is "AXDefaultButton")
            return "clicked"
          end try
        `
      : roleHint === "cancel"
        ? `
          try
            click (first button of front window whose subrole is "AXCancelButton")
            return "clicked"
          end try
          try
            click (first button of sheet 1 of front window whose subrole is "AXCancelButton")
            return "clicked"
          end try
          try
            click (first button of (entire contents of front window) whose role is "AXButton" and subrole is "AXCancelButton")
            return "clicked"
          end try
        `
        : "";
  const script = `
    ${activation}
    tell application "System Events"
      if not (exists process ${appleScriptString(targetName)}) then
        return "no-process"
      end if
      tell process ${appleScriptString(targetName)}
        if (count of windows) is 0 then
          return "no-window"
        end if
        ${roleScript}
        set targetLabels to {${labelList}}
        repeat with targetLabel in targetLabels
          set labelText to targetLabel as text
          try
            click button labelText of front window
            return "clicked"
          end try
          try
            click (first button of front window whose name is labelText)
            return "clicked"
          end try
          try
            click (first button of front window whose name contains labelText)
            return "clicked"
          end try
          try
            click (first button of (entire contents of front window) whose role is "AXButton" and name is labelText)
            return "clicked"
          end try
          try
            click (first button of (entire contents of front window) whose role is "AXButton" and name contains labelText)
            return "clicked"
          end try
          try
            click button labelText of sheet 1 of front window
            return "clicked"
          end try
          try
            click (first button of sheet 1 of front window whose name is labelText)
            return "clicked"
          end try
          try
            click (first button of sheet 1 of front window whose name contains labelText)
            return "clicked"
          end try
        end repeat
      end tell
    end tell
    return "not-found"
  `;
  try {
    const result = await runAppleScript(script);
    const clicked = result === "clicked";
    reportApprovalAttempt({
      phase,
      strategy: "click-button",
      targetApp: approvalTarget,
      hostApp,
      success: clicked,
      detail: `${clicked ? "clicked" : result}; activate=${activate}; roleHint=${roleHint}`,
    });
    return clicked;
  } catch (err) {
    reportApprovalAttempt({
      phase,
      strategy: "click-button",
      targetApp: approvalTarget,
      hostApp,
      success: false,
      detail: `activate=${activate}; roleHint=${roleHint}`,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function runFrontmostCodexKeystroke(keystrokeScript: string): Promise<boolean> {
  const frontmostBundleId = await getFrontmostBundleId();
  if (frontmostBundleId !== CODEX_BUNDLE_ID && frontmostBundleId !== CURSOR_BUNDLE_ID) {
    return false;
  }
  await runFrontmostSystemKeystroke(keystrokeScript);
  return true;
}

export async function approveInTargetApp(targetApp: ApprovalTargetApp): Promise<void> {
  if (targetApp === "codex") {
    const frontmostBundleId = await getFrontmostBundleId();
    const frontmostTarget =
      frontmostBundleId === CODEX_BUNDLE_ID
        ? "codex"
        : frontmostBundleId === CURSOR_BUNDLE_ID
          ? "cursor"
          : null;
    if (
      frontmostTarget &&
      (await clickApprovalButtonInTargetApp(
        "approve",
        targetApp,
        frontmostTarget,
        CODEX_APPROVE_BUTTON_LABELS,
        false,
        "default",
      ))
    ) {
      return;
    }
    if (
      await clickApprovalButtonInTargetApp("approve", targetApp, "codex", CODEX_APPROVE_BUTTON_LABELS, true, "default")
    ) return;
    if (
      await clickApprovalButtonInTargetApp("approve", targetApp, "cursor", CODEX_APPROVE_BUTTON_LABELS, true, "default")
    ) return;

    try {
      // Only use frontmost when it is known to be Codex/Cursor.
      const used = await runFrontmostCodexKeystroke("keystroke return");
      reportApprovalAttempt({
        phase: "approve",
        strategy: "frontmost-keystroke:return",
        targetApp,
        hostApp: "frontmost",
        success: used,
      });
      if (used) return;
    } catch (err) {
      reportApprovalAttempt({
        phase: "approve",
        strategy: "frontmost-keystroke:return",
        targetApp,
        hostApp: "frontmost",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through to explicit app targeting.
    }
  }

  if (targetApp === "codex") {
    // Keypresses can no-op without throwing; try both host apps explicitly.
    try {
      await runSystemKeystroke("codex", "keystroke return");
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
      // Fall through to Cursor attempt.
    }
    await runSystemKeystroke("cursor", "keystroke return");
    reportApprovalAttempt({
      phase: "approve",
      strategy: "keystroke:return",
      targetApp,
      hostApp: "cursor",
      success: true,
    });
    return;
  }

  await runSystemKeystroke(targetApp, "keystroke return");
  reportApprovalAttempt({
    phase: "approve",
    strategy: "keystroke:return",
    targetApp,
    hostApp: targetApp,
    success: true,
  });
}

export function dismissClaudeApproval(): Promise<void> {
  return dismissApprovalInTargetApp("claude");
}

export async function dismissApprovalInTargetApp(targetApp: ApprovalTargetApp): Promise<void> {
  const codexDismissSequence = `key code 53
      delay 0.05
      keystroke "." using command down`;

  if (targetApp === "codex") {
    const frontmostBundleId = await getFrontmostBundleId();
    const frontmostTarget =
      frontmostBundleId === CODEX_BUNDLE_ID
        ? "codex"
        : frontmostBundleId === CURSOR_BUNDLE_ID
          ? "cursor"
          : null;
    if (
      frontmostTarget &&
      (await clickApprovalButtonInTargetApp(
        "dismiss",
        targetApp,
        frontmostTarget,
        CODEX_DISMISS_BUTTON_LABELS,
        false,
        "cancel",
      ))
    ) {
      return;
    }
    if (
      await clickApprovalButtonInTargetApp("dismiss", targetApp, "codex", CODEX_DISMISS_BUTTON_LABELS, true, "cancel")
    ) return;
    if (
      await clickApprovalButtonInTargetApp("dismiss", targetApp, "cursor", CODEX_DISMISS_BUTTON_LABELS, true, "cancel")
    ) return;

    try {
      // Only use frontmost when it is known to be Codex/Cursor.
      const used = await runFrontmostCodexKeystroke(codexDismissSequence);
      reportApprovalAttempt({
        phase: "dismiss",
        strategy: "frontmost-keystroke:escape-cmddot",
        targetApp,
        hostApp: "frontmost",
        success: used,
      });
      if (used) return;
    } catch (err) {
      reportApprovalAttempt({
        phase: "dismiss",
        strategy: "frontmost-keystroke:escape-cmddot",
        targetApp,
        hostApp: "frontmost",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through to explicit app targeting.
    }
  }

  if (targetApp === "codex") {
    // Keypresses can no-op without throwing; try both host apps explicitly.
    try {
      await runSystemKeystroke("codex", codexDismissSequence);
      reportApprovalAttempt({
        phase: "dismiss",
        strategy: "keystroke:escape-cmddot",
        targetApp,
        hostApp: "codex",
        success: true,
      });
      return;
    } catch (err) {
      reportApprovalAttempt({
        phase: "dismiss",
        strategy: "keystroke:escape-cmddot",
        targetApp,
        hostApp: "codex",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through to Cursor attempt.
    }
    await runSystemKeystroke("cursor", codexDismissSequence);
    reportApprovalAttempt({
      phase: "dismiss",
      strategy: "keystroke:escape-cmddot",
      targetApp,
      hostApp: "cursor",
      success: true,
    });
    return;
  }

  await runSystemKeystroke(targetApp, "key code 53");
  reportApprovalAttempt({
    phase: "dismiss",
    strategy: "keystroke:escape",
    targetApp,
    hostApp: targetApp,
    success: true,
  });
}

export function startDictationForClaude(): Promise<void> {
  const script = `
    try
      tell application id "com.anthropic.claudefordesktop" to activate
    on error
      tell application "Claude" to activate
    end try
    delay 0.2
    tell application "System Events"
      tell process "Claude"
        try
          click menu item "Start Dictation…" of menu 1 of menu bar item "Edit" of menu bar 1
        on error
          click menu item "Start Dictation..." of menu 1 of menu bar item "Edit" of menu bar 1
        end try
      end tell
    end tell
  `;
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (asErr) => {
      if (asErr) return reject(asErr);
      resolve();
    });
  });
}
