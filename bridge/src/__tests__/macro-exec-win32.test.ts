/**
 * Tests for macro-exec-win32.ts — Windows text injection, approval automation,
 * and focus management via PowerShell + Win32 API.
 *
 * Mocks child_process.execFile to intercept `powershell` and `clip` calls.
 * Tests run on all platforms (using mocks) to verify logic.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ChildProcess } from "node:child_process";

// ── Mocks ────────────────────────────────────────────────────────────────────

/** Track PowerShell and clip calls for assertions. */
const powershellCalls: string[] = [];
let clipData: string | null = null;

/** Simulated foreground snapshot: processName\twindowTitle\thwnd */
const PREV_SNAPSHOT = "notepad\tUntitled - Notepad\t12345";
const CLAUDE_SNAPSHOT = "Claude\tClaude\t67890";

function makeMock(snapshotReturn: string) {
  return (
    cmd: string,
    argsOrOpts?: string[] | Record<string, unknown> | ((err: Error | null, stdout?: string) => void),
    optsOrCb?: Record<string, unknown> | ((err: Error | null, stdout?: string) => void),
    maybeCb?: (err: Error | null, stdout?: string) => void,
  ) => {
    // Resolve the callback from the variable-arity signatures
    let callback: ((err: Error | null, stdout?: string) => void) | undefined;
    if (typeof maybeCb === "function") callback = maybeCb;
    else if (typeof optsOrCb === "function") callback = optsOrCb;
    else if (typeof argsOrOpts === "function") callback = argsOrOpts;

    const args = Array.isArray(argsOrOpts) ? argsOrOpts : [];

    if (cmd === "clip") {
      const fakeStdin = {
        write: vi.fn((data: string) => { clipData = data; }),
        end: vi.fn(() => callback?.(null)),
      };
      return { stdin: fakeStdin } as unknown as ChildProcess;
    }

    if (cmd === "powershell") {
      // The PowerShell script is in args after -NoProfile -NonInteractive -Command
      const script = args[args.indexOf("-Command") + 1] ?? "";
      powershellCalls.push(script);

      // If the script captures the foreground window, return the snapshot
      if (script.includes("GetForegroundWindow") && script.includes("GetWindowText")) {
        callback?.(null, snapshotReturn);
        return {} as ChildProcess;
      }

      // UI Automation scripts — simulate different results based on content
      if (script.includes("UIAutomationClient")) {
        // Default: button not found (tests can override)
        callback?.(null, "not-found");
        return {} as ChildProcess;
      }

      // Default: succeed silently
      callback?.(null, "");
      return {} as ChildProcess;
    }

    callback?.(null, "");
    return {} as ChildProcess;
  };
}

vi.mock("node:child_process", () => ({
  execFile: vi.fn(makeMock(PREV_SNAPSHOT)),
}));

// Import after mocks are installed — import directly from the win32 module.
const {
  executeMacro,
  surfaceTargetApp,
  approveOnceInClaude,
  dismissClaudeApproval,
  startDictationForClaude,
  setApprovalAttemptLogger,
  withApprovalAttemptContext,
} = await import("../macro-exec-win32.js");

const childProcess = await import("node:child_process");

beforeEach(() => {
  powershellCalls.length = 0;
  clipData = null;
  vi.clearAllMocks();
  (childProcess.execFile as unknown as Mock).mockImplementation(makeMock(PREV_SNAPSHOT));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeMacro (win32)", () => {
  it("copies text to clipboard via clip.exe", async () => {
    await executeMacro("hello world", { targetApp: "claude", submit: true });
    expect(clipData).toBe("hello world");
  });

  it("runs PowerShell to activate, paste, and submit", async () => {
    await executeMacro("test", { targetApp: "claude", submit: true });

    // Should have 2 powershell calls: getForegroundSnapshot + paste script
    expect(powershellCalls).toHaveLength(2);

    // Second call is the paste+restore script
    const pasteScript = powershellCalls[1];
    expect(pasteScript).toContain("Get-Process -Name 'Claude'");
    expect(pasteScript).toContain("SendKeys");
    expect(pasteScript).toContain("^v");
    expect(pasteScript).toContain("{ENTER}");
  });

  it("skips submit when submit=false", async () => {
    await executeMacro("no-submit", { targetApp: "cursor", submit: false });

    const pasteScript = powershellCalls[1];
    expect(pasteScript).toContain("Get-Process -Name 'Cursor'");
    expect(pasteScript).toContain("^v");
    expect(pasteScript).not.toContain("{ENTER}");
  });

  it("restores focus when previous app differs from target", async () => {
    await executeMacro("test", { targetApp: "claude", submit: true });

    const pasteScript = powershellCalls[1];
    // Should restore to the previous window (notepad, hwnd 12345)
    expect(pasteScript).toContain("SetForegroundWindow");
    expect(pasteScript).toContain("12345");
  });

  it("does not restore focus when already in target app", async () => {
    (childProcess.execFile as unknown as Mock).mockImplementation(makeMock(CLAUDE_SNAPSHOT));

    await executeMacro("test", { targetApp: "claude", submit: true });

    const pasteScript = powershellCalls[1];
    // Should NOT contain restore logic — no hwnd reference
    // The paste script should not try to restore to Claude (already there)
    const lines = pasteScript.split("\n").filter((l: string) =>
      l.includes("67890") && l.includes("SetForegroundWindow"),
    );
    expect(lines).toHaveLength(0);
  });

  it("uses correct process name for each target app", async () => {
    const targets = ["claude", "codex", "chatgpt", "cursor", "windsurf"] as const;
    const expectedNames = ["Claude", "Codex", "ChatGPT", "Cursor", "Windsurf"];

    for (let i = 0; i < targets.length; i++) {
      powershellCalls.length = 0;
      (childProcess.execFile as unknown as Mock).mockImplementation(makeMock(PREV_SNAPSHOT));

      await executeMacro("test", { targetApp: targets[i] });

      const pasteScript = powershellCalls[1];
      expect(pasteScript).toContain(`Get-Process -Name '${expectedNames[i]}'`);
    }
  });
});

describe("surfaceTargetApp (win32)", () => {
  it("activates the target via PowerShell SetForegroundWindow", async () => {
    await surfaceTargetApp("claude");

    expect(powershellCalls).toHaveLength(1);
    expect(powershellCalls[0]).toContain("Get-Process -Name 'Claude'");
    expect(powershellCalls[0]).toContain("SetForegroundWindow");
    expect(powershellCalls[0]).toContain("ShowWindow");
  });
});

describe("approveOnceInClaude (win32)", () => {
  it("tries UI Automation first, falls back to Enter keystroke", async () => {
    await approveOnceInClaude();

    // Should have at least one UIA call (for claude) + one SendKeys call
    const uiaCalls = powershellCalls.filter((s) => s.includes("UIAutomationClient"));
    const keysCalls = powershellCalls.filter((s) =>
      s.includes("SendKeys") && s.includes("{ENTER}"),
    );

    expect(uiaCalls.length).toBeGreaterThanOrEqual(1);
    expect(keysCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("checks approval button labels in UIA script", async () => {
    await approveOnceInClaude();

    const uiaScript = powershellCalls.find((s) => s.includes("UIAutomationClient"));
    expect(uiaScript).toBeDefined();
    expect(uiaScript).toContain("'Allow'");
    expect(uiaScript).toContain("'Approve'");
    expect(uiaScript).toContain("'Yes'");
    expect(uiaScript).toContain("'Continue'");
  });

  it("skips keystroke fallback when UIA succeeds", async () => {
    // Override UIA to return "clicked:Allow"
    (childProcess.execFile as unknown as Mock).mockImplementation(
      (
        cmd: string,
        argsOrOpts?: string[] | Record<string, unknown> | ((err: Error | null, stdout?: string) => void),
        optsOrCb?: Record<string, unknown> | ((err: Error | null, stdout?: string) => void),
        maybeCb?: (err: Error | null, stdout?: string) => void,
      ) => {
        let callback: ((err: Error | null, stdout?: string) => void) | undefined;
        if (typeof maybeCb === "function") callback = maybeCb;
        else if (typeof optsOrCb === "function") callback = optsOrCb;
        else if (typeof argsOrOpts === "function") callback = argsOrOpts;
        const args = Array.isArray(argsOrOpts) ? argsOrOpts : [];

        if (cmd === "powershell") {
          const script = args[args.indexOf("-Command") + 1] ?? "";
          powershellCalls.push(script);
          if (script.includes("UIAutomationClient")) {
            callback?.(null, "clicked:Allow");
            return {} as ChildProcess;
          }
          callback?.(null, "");
          return {} as ChildProcess;
        }
        callback?.(null, "");
        return {} as ChildProcess;
      },
    );

    await approveOnceInClaude();

    // Only UIA call, no SendKeys fallback
    const keysCalls = powershellCalls.filter((s) =>
      s.includes("SendKeys") && s.includes("{ENTER}"),
    );
    expect(keysCalls).toHaveLength(0);
  });
});

describe("dismissClaudeApproval (win32)", () => {
  it("tries UI Automation first, falls back to Escape keystroke", async () => {
    await dismissClaudeApproval();

    const uiaCalls = powershellCalls.filter((s) => s.includes("UIAutomationClient"));
    const keysCalls = powershellCalls.filter((s) =>
      s.includes("SendKeys") && s.includes("{ESC}"),
    );

    expect(uiaCalls.length).toBeGreaterThanOrEqual(1);
    expect(keysCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("checks dismiss button labels in UIA script", async () => {
    await dismissClaudeApproval();

    const uiaScript = powershellCalls.find((s) => s.includes("UIAutomationClient"));
    expect(uiaScript).toBeDefined();
    expect(uiaScript).toContain("'Deny'");
    expect(uiaScript).toContain("'Cancel'");
    expect(uiaScript).toContain("'Reject'");
    expect(uiaScript).toContain("'Dismiss'");
  });
});

describe("startDictationForClaude (win32)", () => {
  it("activates Claude and sends Ctrl+H", async () => {
    await startDictationForClaude();

    expect(powershellCalls).toHaveLength(1);
    expect(powershellCalls[0]).toContain("Get-Process -Name 'Claude'");
    expect(powershellCalls[0]).toContain("SendKeys");
    expect(powershellCalls[0]).toContain("^h");
  });
});

describe("approval attempt logging (win32)", () => {
  it("reports attempts via the logger callback", async () => {
    const attempts: Array<{ phase: string; strategy: string; success: boolean }> = [];
    setApprovalAttemptLogger((attempt) => {
      attempts.push({
        phase: attempt.phase,
        strategy: attempt.strategy,
        success: attempt.success,
      });
    });

    await approveOnceInClaude();

    // Should have logged at least one UIA attempt (failed) + one keystroke attempt (success)
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    const uiaAttempt = attempts.find((a) => a.strategy === "uia-button-click");
    expect(uiaAttempt).toBeDefined();
    expect(uiaAttempt!.success).toBe(false);

    const keyAttempt = attempts.find((a) => a.strategy === "keystroke:enter");
    expect(keyAttempt).toBeDefined();
    expect(keyAttempt!.success).toBe(true);

    // Clean up
    setApprovalAttemptLogger(null);
  });

  it("tracks context ID via withApprovalAttemptContext", async () => {
    const contextIds: Array<string | null> = [];
    setApprovalAttemptLogger((attempt) => {
      contextIds.push(attempt.contextId);
    });

    await withApprovalAttemptContext("test-action-123", async () => {
      await approveOnceInClaude();
    });

    expect(contextIds.length).toBeGreaterThan(0);
    expect(contextIds.every((id) => id === "test-action-123")).toBe(true);

    // Clean up
    setApprovalAttemptLogger(null);
  });
});
