/**
 * Tests for macro-exec-linux.ts — Linux/X11 text injection, approval automation,
 * and focus management via xdotool + xclip.
 *
 * Mocks child_process.execFile to intercept `xdotool` and `xclip` calls.
 * Tests run on all platforms (using mocks) to verify logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { ChildProcess } from "node:child_process";

// ── Mocks ────────────────────────────────────────────────────────────────────

/** Track xdotool and xclip calls for assertions. */
const xdotoolCalls: string[][] = [];
let xclipData: string | null = null;

/** Simulated active window ID and metadata. */
const PREV_WINDOW = { wid: "12345678", name: "Untitled - gedit", pid: "4567" };
const CLAUDE_WINDOW = { wid: "87654321", name: "Claude", pid: "7890" };

function makeMock(activeWindow = PREV_WINDOW) {
  return (
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

    if (cmd === "xclip") {
      const fakeStdin = {
        write: vi.fn((data: string) => { xclipData = data; }),
        end: vi.fn(() => callback?.(null)),
      };
      return { stdin: fakeStdin } as unknown as ChildProcess;
    }

    if (cmd === "xdotool") {
      xdotoolCalls.push(args);
      const subCmd = args[0];

      if (subCmd === "getactivewindow" && args.length === 1) {
        callback?.(null, activeWindow.wid);
        return {} as ChildProcess;
      }
      if (subCmd === "getwindowname") {
        callback?.(null, activeWindow.name);
        return {} as ChildProcess;
      }
      if (subCmd === "getwindowpid") {
        callback?.(null, activeWindow.pid);
        return {} as ChildProcess;
      }
      if (subCmd === "search") {
        // Return Claude window ID for claude searches, empty for unknown
        const classArg = args[args.indexOf("--class") + 1] ?? args[args.indexOf("--name") + 1] ?? "";
        if (classArg.toLowerCase() === "claude") {
          callback?.(null, CLAUDE_WINDOW.wid);
        } else if (classArg.toLowerCase() === "cursor") {
          callback?.(null, "99999999");
        } else {
          callback?.(null, "11111111");
        }
        return {} as ChildProcess;
      }
      if (subCmd === "windowactivate" || subCmd === "key") {
        callback?.(null, "");
        return {} as ChildProcess;
      }

      callback?.(null, "");
      return {} as ChildProcess;
    }

    callback?.(null, "");
    return {} as ChildProcess;
  };
}

vi.mock("node:child_process", () => ({
  execFile: vi.fn(makeMock()),
}));

// Import after mocks are installed — import directly from the linux module.
const {
  executeMacro,
  surfaceTargetApp,
  approveOnceInClaude,
  dismissClaudeApproval,
  startDictationForClaude,
  setApprovalAttemptLogger,
  withApprovalAttemptContext,
} = await import("../macro-exec-linux.js");

const childProcess = await import("node:child_process");

// Save and restore env vars for Wayland tests
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  xdotoolCalls.length = 0;
  xclipData = null;
  vi.clearAllMocks();
  (childProcess.execFile as unknown as Mock).mockImplementation(makeMock());
  // Ensure X11 environment for most tests
  savedEnv.XDG_SESSION_TYPE = process.env.XDG_SESSION_TYPE;
  savedEnv.WAYLAND_DISPLAY = process.env.WAYLAND_DISPLAY;
  savedEnv.DISPLAY = process.env.DISPLAY;
  process.env.XDG_SESSION_TYPE = "x11";
  delete process.env.WAYLAND_DISPLAY;
  process.env.DISPLAY = ":0";
});

afterEach(() => {
  // Restore env
  if (savedEnv.XDG_SESSION_TYPE !== undefined) process.env.XDG_SESSION_TYPE = savedEnv.XDG_SESSION_TYPE;
  else delete process.env.XDG_SESSION_TYPE;
  if (savedEnv.WAYLAND_DISPLAY !== undefined) process.env.WAYLAND_DISPLAY = savedEnv.WAYLAND_DISPLAY;
  else delete process.env.WAYLAND_DISPLAY;
  if (savedEnv.DISPLAY !== undefined) process.env.DISPLAY = savedEnv.DISPLAY;
  else delete process.env.DISPLAY;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeMacro (linux)", () => {
  it("copies text to clipboard via xclip", async () => {
    await executeMacro("hello linux", { targetApp: "claude", submit: true });
    expect(xclipData).toBe("hello linux");
  });

  it("uses xdotool to capture focus, activate, paste, submit, and restore", async () => {
    await executeMacro("test", { targetApp: "claude", submit: true });

    // Should have xdotool calls for: getactivewindow, getwindowname, getwindowpid,
    // search, windowactivate, key ctrl+v, key Return, windowactivate (restore)
    const cmdNames = xdotoolCalls.map((args) => args[0]);
    expect(cmdNames).toContain("getactivewindow");
    expect(cmdNames).toContain("search");
    expect(cmdNames).toContain("windowactivate");

    // Verify paste keystroke
    const pasteCall = xdotoolCalls.find((args) => args[0] === "key" && args[1] === "ctrl+v");
    expect(pasteCall).toBeDefined();

    // Verify submit keystroke
    const submitCall = xdotoolCalls.find((args) => args[0] === "key" && args[1] === "Return");
    expect(submitCall).toBeDefined();
  });

  it("skips submit when submit=false", async () => {
    await executeMacro("no-submit", { targetApp: "cursor", submit: false });

    const pasteCall = xdotoolCalls.find((args) => args[0] === "key" && args[1] === "ctrl+v");
    expect(pasteCall).toBeDefined();

    const submitCall = xdotoolCalls.find((args) => args[0] === "key" && args[1] === "Return");
    expect(submitCall).toBeUndefined();
  });

  it("restores focus when previous window differs from target", async () => {
    await executeMacro("test", { targetApp: "claude", submit: true });

    // Should restore to PREV_WINDOW.wid (12345678)
    const restoreCalls = xdotoolCalls.filter(
      (args) => args[0] === "windowactivate" && args.includes(PREV_WINDOW.wid),
    );
    expect(restoreCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("does not restore focus when already in target app", async () => {
    (childProcess.execFile as unknown as Mock).mockImplementation(makeMock(CLAUDE_WINDOW));

    await executeMacro("test", { targetApp: "claude", submit: true });

    // Should NOT have a restore call to CLAUDE_WINDOW.wid after the initial activate
    // The windowactivate calls should only be for the target, not a restore
    const activateCalls = xdotoolCalls.filter((args) => args[0] === "windowactivate");
    // Only one activate (for the target), no restore
    const restoreCalls = activateCalls.filter(
      (args) => args.includes(CLAUDE_WINDOW.wid) &&
        xdotoolCalls.indexOf(args) > xdotoolCalls.findIndex((a) => a[0] === "key" && a[1] === "ctrl+v"),
    );
    expect(restoreCalls).toHaveLength(0);
  });

  it("searches by WM_CLASS for each target app", async () => {
    await executeMacro("test", { targetApp: "windsurf" });

    const searchCall = xdotoolCalls.find(
      (args) => args[0] === "search" && args.includes("--class") && args.includes("windsurf"),
    );
    expect(searchCall).toBeDefined();
  });
});

describe("surfaceTargetApp (linux)", () => {
  it("activates the target via xdotool search + windowactivate", async () => {
    await surfaceTargetApp("claude");

    const searchCall = xdotoolCalls.find(
      (args) => args[0] === "search" && args.includes("claude"),
    );
    expect(searchCall).toBeDefined();

    const activateCall = xdotoolCalls.find((args) => args[0] === "windowactivate");
    expect(activateCall).toBeDefined();
  });
});

describe("approveOnceInClaude (linux)", () => {
  it("activates Claude and sends Return keystroke", async () => {
    await approveOnceInClaude();

    const searchCall = xdotoolCalls.find(
      (args) => args[0] === "search" && args.includes("claude"),
    );
    expect(searchCall).toBeDefined();

    const keyCall = xdotoolCalls.find(
      (args) => args[0] === "key" && args[1] === "Return",
    );
    expect(keyCall).toBeDefined();
  });
});

describe("dismissClaudeApproval (linux)", () => {
  it("activates Claude and sends Escape keystroke", async () => {
    await dismissClaudeApproval();

    const keyCall = xdotoolCalls.find(
      (args) => args[0] === "key" && args[1] === "Escape",
    );
    expect(keyCall).toBeDefined();
  });
});

describe("startDictationForClaude (linux)", () => {
  it("rejects with unsupported error", async () => {
    await expect(startDictationForClaude()).rejects.toThrow("not supported on Linux");
  });
});

describe("Wayland detection (linux)", () => {
  it("throws when XDG_SESSION_TYPE is wayland", async () => {
    process.env.XDG_SESSION_TYPE = "wayland";

    await expect(executeMacro("test")).rejects.toThrow("Wayland");
    await expect(surfaceTargetApp("claude")).rejects.toThrow("Wayland");
    await expect(approveOnceInClaude()).rejects.toThrow("Wayland");
    await expect(dismissClaudeApproval()).rejects.toThrow("Wayland");
  });

  it("works when XDG_SESSION_TYPE is x11", async () => {
    process.env.XDG_SESSION_TYPE = "x11";

    // Should not throw
    await executeMacro("test");
    expect(xclipData).toBe("test");
  });
});

describe("approval attempt logging (linux)", () => {
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

    expect(attempts.length).toBeGreaterThanOrEqual(1);
    const keyAttempt = attempts.find((a) => a.strategy === "keystroke:return");
    expect(keyAttempt).toBeDefined();
    expect(keyAttempt!.success).toBe(true);

    setApprovalAttemptLogger(null);
  });

  it("tracks context ID via withApprovalAttemptContext", async () => {
    const contextIds: Array<string | null> = [];
    setApprovalAttemptLogger((attempt) => {
      contextIds.push(attempt.contextId);
    });

    await withApprovalAttemptContext("linux-test-42", async () => {
      await approveOnceInClaude();
    });

    expect(contextIds.length).toBeGreaterThan(0);
    expect(contextIds.every((id) => id === "linux-test-42")).toBe(true);

    setApprovalAttemptLogger(null);
  });
});
