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
 * Inject text into the selected app by copying to clipboard and pasting.
 * Returns a promise that resolves when the AppleScript completes.
 */
export function executeMacro(text: string, options: MacroExecutionOptions = {}): Promise<void> {
  const targetApp = options.targetApp ?? "claude";
  const submit = options.submit !== false;
  const activation = activationScriptFor(targetApp);

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

  return new Promise((resolve, reject) => {
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
}

export function approveOnceInClaude(): Promise<void> {
  return approveInTargetApp("claude");
}

export type ApprovalTargetApp = "claude" | "codex";

function runSystemKeystroke(targetApp: TargetApp, keystrokeScript: string): Promise<void> {
  const activation = activationScriptFor(targetApp);
  const script = `
    ${activation}
    delay 0.15
    tell application "System Events"
      ${keystrokeScript}
    end tell
  `;
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (asErr) => {
      if (asErr) return reject(asErr);
      resolve();
    });
  });
}

export async function approveInTargetApp(targetApp: ApprovalTargetApp): Promise<void> {
  try {
    await runSystemKeystroke(targetApp, "keystroke return");
  } catch (err) {
    // Codex approvals may be hosted inside Cursor.app; retry there.
    if (targetApp !== "codex") throw err;
    await runSystemKeystroke("cursor", "keystroke return");
  }
}

export function dismissClaudeApproval(): Promise<void> {
  return dismissApprovalInTargetApp("claude");
}

export async function dismissApprovalInTargetApp(targetApp: ApprovalTargetApp): Promise<void> {
  try {
    await runSystemKeystroke(targetApp, "key code 53");
  } catch (err) {
    // Codex approvals may be hosted inside Cursor.app; retry there.
    if (targetApp !== "codex") throw err;
    await runSystemKeystroke("cursor", "key code 53");
  }
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
