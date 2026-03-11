/**
 * Macro executor — Windows backend.
 *
 * Injects text into a target app via clipboard + SendKeys, activates windows
 * via SetForegroundWindow, and clicks approval buttons via UI Automation.
 * All automation uses PowerShell + Win32 p/invoke — no native npm dependencies.
 *
 * Architecture mirrors macro-exec-darwin.ts:
 *   - `clip.exe` for clipboard (fast, no PowerShell startup)
 *   - Single PowerShell invocation for activate + paste + restore (atomic)
 *   - UI Automation via .NET for button clicking (approval automation)
 */

import { execFile } from "node:child_process";
import type { TargetApp } from "./config.js";

interface MacroExecutionOptions {
  targetApp?: TargetApp;
  submit?: boolean;
}

// ── App identification ────────────────────────────────────────────────────────

interface Win32TargetAppSpec {
  processName: string;
  windowTitle: string;
}

const TARGET_APP_SPECS: Record<TargetApp, Win32TargetAppSpec> = {
  claude:   { processName: "Claude",   windowTitle: "Claude" },
  codex:    { processName: "Codex",    windowTitle: "Codex" },
  chatgpt:  { processName: "ChatGPT",  windowTitle: "ChatGPT" },
  cursor:   { processName: "Cursor",   windowTitle: "Cursor" },
  windsurf: { processName: "Windsurf", windowTitle: "Windsurf" },
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

// ── Button labels for approval automation ─────────────────────────────────────

const APPROVE_BUTTON_LABELS = [
  "Yes",
  "Allow",
  "Approve",
  "Continue",
  "Run",
  "OK",
] as const;

const DISMISS_BUTTON_LABELS = [
  "Reject",
  "Deny",
  "Cancel",
  "Dismiss",
  "Decline",
  "No",
  "Don't allow",
] as const;

// ── PowerShell helpers ────────────────────────────────────────────────────────

/**
 * The C# type definition for Win32 window management.
 * Added once per PowerShell session via Add-Type.
 */
const WIN_API_TYPE = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DeckyWinAPI {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
`;

/**
 * Escape a string for embedding in a PowerShell single-quoted string.
 * Single-quoted strings in PowerShell only need ' escaped as ''.
 */
function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 15_000 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve((stdout ?? "").trim());
      },
    );
  });
}

// ── Focus capture / restore ───────────────────────────────────────────────────

interface ForegroundSnapshot {
  processName: string;
  windowTitle: string;
  hwnd: string;
}

async function getForegroundSnapshot(): Promise<ForegroundSnapshot | null> {
  const script = `
${WIN_API_TYPE}
$hwnd = [DeckyWinAPI]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[DeckyWinAPI]::GetWindowText($hwnd, $sb, 256) | Out-Null
$pid = [uint32]0
[DeckyWinAPI]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
"$($proc.ProcessName)\t$($sb.ToString())\t$hwnd"
`;
  try {
    const raw = await runPowerShell(script);
    const [processName, windowTitle, hwnd] = raw.split("\t");
    if (!processName || !hwnd) return null;
    return { processName, windowTitle: windowTitle ?? "", hwnd };
  } catch {
    return null;
  }
}

// ── Activate target app ───────────────────────────────────────────────────────

function buildActivateScript(targetApp: TargetApp): string {
  const spec = TARGET_APP_SPECS[targetApp];
  return `
$proc = Get-Process -Name '${psEscape(spec.processName)}' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
  [DeckyWinAPI]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [DeckyWinAPI]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
}
`;
}

/**
 * Bring the target app to the foreground without interacting with it.
 */
export async function surfaceTargetApp(targetApp: TargetApp): Promise<void> {
  const script = `
${WIN_API_TYPE}
${buildActivateScript(targetApp)}
`;
  await runPowerShell(script);
}

// ── Text injection (executeMacro) ─────────────────────────────────────────────

/**
 * Copy text to the Windows clipboard via clip.exe (fast, avoids PS startup).
 */
function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const clip = execFile("clip", (err) => {
      if (err) {
        console.error("[macro-win32] clip.exe failed:", err.message);
        reject(err);
        return;
      }
      resolve();
    });
    clip.stdin?.write(text);
    clip.stdin?.end();
  });
}

/**
 * Inject text into the selected app by copying to clipboard and pasting.
 *
 * Quick-focus-steal: captures the foreground window before activating the
 * target, then restores it after paste+submit.
 */
export async function executeMacro(text: string, options: MacroExecutionOptions = {}): Promise<void> {
  const targetApp = options.targetApp ?? "claude";
  const submit = options.submit !== false;
  const spec = TARGET_APP_SPECS[targetApp];

  // Capture the currently focused window *before* we steal focus.
  const snapshot = await getForegroundSnapshot();
  const needsRestore = snapshot != null &&
    snapshot.processName.toLowerCase() !== spec.processName.toLowerCase();

  // Copy text to clipboard first (fast path via clip.exe).
  await copyToClipboard(text);

  // Build the combined PowerShell script: activate → paste → submit → restore.
  const restoreFragment = needsRestore
    ? `
Start-Sleep -Milliseconds ${targetApp === "claude" ? 300 : 1500}
[DeckyWinAPI]::ShowWindow([IntPtr]${snapshot!.hwnd}, 9) | Out-Null
[DeckyWinAPI]::SetForegroundWindow([IntPtr]${snapshot!.hwnd}) | Out-Null
`
    : "";

  const submitFragment = submit
    ? `
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
`
    : "";

  const script = `
${WIN_API_TYPE}
Add-Type -AssemblyName System.Windows.Forms
${buildActivateScript(targetApp)}
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("^v")
${submitFragment}
${restoreFragment}
`;

  console.log(`[macro-win32] powershell for target=${targetApp}, hasRestore=${needsRestore}`);
  await runPowerShell(script);
  console.log(
    `[macro-win32] injected target=${targetApp}: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`,
  );
  if (needsRestore) {
    console.log(
      `[macro-win32] restored focus to ${snapshot!.processName}` +
        (snapshot!.windowTitle ? ` window "${snapshot!.windowTitle}"` : ""),
    );
  }
}

// ── Approval automation ───────────────────────────────────────────────────────

/**
 * Try to find and click a button in the target app using UI Automation.
 * Falls back through multiple strategies: exact name, then contains.
 *
 * Returns true if a button was found and clicked.
 */
async function clickButtonViaUIA(
  targetApp: TargetApp,
  labels: readonly string[],
  phase: "approve" | "dismiss",
  approvalTarget: ApprovalTargetApp,
): Promise<boolean> {
  const spec = TARGET_APP_SPECS[targetApp];

  // Build PowerShell script that tries each label via UI Automation.
  // Uses .NET UIAutomationClient for button discovery.
  const labelArray = labels.map((l) => `'${psEscape(l)}'`).join(",");
  const script = `
${WIN_API_TYPE}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$proc = Get-Process -Name '${psEscape(spec.processName)}' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc -or $proc.MainWindowHandle -eq [IntPtr]::Zero) {
  Write-Output 'no-process'
  exit 0
}

# Activate the app first
[DeckyWinAPI]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
[DeckyWinAPI]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 200

$root = [System.Windows.Automation.AutomationElement]::RootElement
$pidCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
$appEl = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $pidCond)
if (-not $appEl) {
  Write-Output 'no-window'
  exit 0
}

$btnType = [System.Windows.Automation.ControlType]::Button
$labels = @(${labelArray})

foreach ($label in $labels) {
  # Strategy 1: exact name match
  $nameCond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $btnType)),
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $label)))
  $btn = $appEl.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCond)
  if ($btn) {
    try {
      $invoke = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invoke.Invoke()
      Write-Output "clicked:$label"
      exit 0
    } catch { }
  }
}

# Strategy 2: substring match via iteration
$allBtnCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $btnType)
$allBtns = $appEl.FindAll([System.Windows.Automation.TreeScope]::Descendants, $allBtnCond)
foreach ($label in $labels) {
  foreach ($b in $allBtns) {
    $name = $b.Current.Name
    if ($name -and $name.Contains($label)) {
      try {
        $invoke = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
        Write-Output "clicked:$name"
        exit 0
      } catch { }
    }
  }
}

Write-Output 'not-found'
`;

  try {
    const result = await runPowerShell(script);

    if (result.startsWith("clicked:")) {
      const buttonName = result.slice("clicked:".length);
      reportApprovalAttempt({
        phase,
        strategy: "uia-button-click",
        targetApp: approvalTarget,
        hostApp: targetApp,
        success: true,
        detail: `button="${buttonName}"`,
      });
      return true;
    }

    reportApprovalAttempt({
      phase,
      strategy: "uia-button-click",
      targetApp: approvalTarget,
      hostApp: targetApp,
      success: false,
      detail: result,
    });
    return false;
  } catch (err) {
    reportApprovalAttempt({
      phase,
      strategy: "uia-button-click",
      targetApp: approvalTarget,
      hostApp: targetApp,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Send a keystroke to the target app via PowerShell SendKeys.
 */
async function sendKeystroke(targetApp: TargetApp, keys: string): Promise<void> {
  const script = `
${WIN_API_TYPE}
Add-Type -AssemblyName System.Windows.Forms
${buildActivateScript(targetApp)}
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('${psEscape(keys)}')
`;
  await runPowerShell(script);
}

async function approveInTargetApp(targetApp: ApprovalTargetApp): Promise<void> {
  // Strategy 1: Try UI Automation button click (exhaustive label search)
  if (targetApp === "codex") {
    // Try Codex first, then Cursor (Codex runs inside Cursor on some setups)
    if (await clickButtonViaUIA("codex", APPROVE_BUTTON_LABELS, "approve", targetApp)) return;
    if (await clickButtonViaUIA("cursor", APPROVE_BUTTON_LABELS, "approve", targetApp)) return;
  } else {
    if (await clickButtonViaUIA(targetApp, APPROVE_BUTTON_LABELS, "approve", targetApp)) return;
  }

  // Strategy 2: Fallback to keystroke Enter
  if (targetApp === "codex") {
    try {
      await sendKeystroke("codex", "{ENTER}");
      reportApprovalAttempt({
        phase: "approve",
        strategy: "keystroke:enter",
        targetApp,
        hostApp: "codex",
        success: true,
      });
      return;
    } catch (err) {
      reportApprovalAttempt({
        phase: "approve",
        strategy: "keystroke:enter",
        targetApp,
        hostApp: "codex",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await sendKeystroke("cursor", "{ENTER}");
    reportApprovalAttempt({
      phase: "approve",
      strategy: "keystroke:enter",
      targetApp,
      hostApp: "cursor",
      success: true,
    });
    return;
  }

  await sendKeystroke(targetApp, "{ENTER}");
  reportApprovalAttempt({
    phase: "approve",
    strategy: "keystroke:enter",
    targetApp,
    hostApp: targetApp,
    success: true,
  });
}

export function approveOnceInClaude(): Promise<void> {
  return approveInTargetApp("claude");
}

async function dismissApprovalInTargetApp(targetApp: ApprovalTargetApp): Promise<void> {
  // Strategy 1: Try UI Automation button click
  if (targetApp === "codex") {
    if (await clickButtonViaUIA("codex", DISMISS_BUTTON_LABELS, "dismiss", targetApp)) return;
    if (await clickButtonViaUIA("cursor", DISMISS_BUTTON_LABELS, "dismiss", targetApp)) return;
  } else {
    if (await clickButtonViaUIA(targetApp, DISMISS_BUTTON_LABELS, "dismiss", targetApp)) return;
  }

  // Strategy 2: Fallback to Escape keystroke
  if (targetApp === "codex") {
    try {
      await sendKeystroke("codex", "{ESC}");
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
    await sendKeystroke("cursor", "{ESC}");
    reportApprovalAttempt({
      phase: "dismiss",
      strategy: "keystroke:escape",
      targetApp,
      hostApp: "cursor",
      success: true,
    });
    return;
  }

  await sendKeystroke(targetApp, "{ESC}");
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

/**
 * Start dictation in Claude. On Windows, triggers Win+H (Windows Speech
 * Recognition) after activating Claude. This is best-effort — depends on
 * Windows speech services being enabled.
 */
export async function startDictationForClaude(): Promise<void> {
  const script = `
${WIN_API_TYPE}
Add-Type -AssemblyName System.Windows.Forms
${buildActivateScript("claude")}
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^h")
`;
  await runPowerShell(script);
}
