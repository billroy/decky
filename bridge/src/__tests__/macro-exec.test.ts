/**
 * Tests for macro-exec.ts — specifically the quick-focus-steal behaviour
 * in executeMacro().
 *
 * We mock child_process.execFile so no real AppleScript or pbcopy runs.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ChildProcess } from "node:child_process";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Track osascript calls in order so we can assert focus-steal sequencing.
const osascriptCalls: string[] = [];

/** Tab-separated snapshot returned by the frontmost-snapshot query. */
const PREV_SNAPSHOT = "com.example.previous\tSomeApp\tMy Document — SomeApp";
const CLAUDE_SNAPSHOT = "com.anthropic.claudefordesktop\tClaude\tChat with Claude";

function makeMock(snapshotReturn: string) {
  return (
    cmd: string,
    argsOrCb?: string[] | ((err: Error | null, stdout?: string) => void),
    cb?: (err: Error | null, stdout?: string) => void,
  ) => {
    const callback = typeof argsOrCb === "function" ? argsOrCb : cb;
    const args = Array.isArray(argsOrCb) ? argsOrCb : [];

    if (cmd === "pbcopy") {
      const fakeStdin = {
        write: vi.fn(),
        end: vi.fn(() => callback?.(null)),
      };
      return { stdin: fakeStdin } as unknown as ChildProcess;
    }

    if (cmd === "osascript") {
      const script = args[1] ?? "";
      osascriptCalls.push(script);

      // getFrontmostSnapshot query — return the configured snapshot.
      if (script.includes("bundle identifier of frontApp")) {
        callback?.(null, snapshotReturn);
        return {} as ChildProcess;
      }

      // Any other osascript call (activation, paste, restore) succeeds.
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

// Import after mocks are installed.
const { executeMacro } = await import("../macro-exec.js");

const childProcess = await import("node:child_process");

beforeEach(() => {
  osascriptCalls.length = 0;
  vi.clearAllMocks();
  (childProcess.execFile as unknown as Mock).mockImplementation(makeMock(PREV_SNAPSHOT));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeMacro quick-focus-steal", () => {
  it("restores focus to previous app and window after injection", async () => {
    await executeMacro("hello", { targetApp: "claude", submit: true });

    // Should have at least 3 osascript calls:
    // 1. getFrontmostSnapshot
    // 2. activation + paste + submit
    // 3. restore previous app + window
    expect(osascriptCalls.length).toBeGreaterThanOrEqual(3);

    // First call: getFrontmostSnapshot
    expect(osascriptCalls[0]).toContain("bundle identifier of frontApp");

    // Second call: activates Claude and pastes
    expect(osascriptCalls[1]).toContain("com.anthropic.claudefordesktop");
    expect(osascriptCalls[1]).toContain('keystroke "v" using command down');

    // Third call: restores via AXRaise on the specific window + process.
    expect(osascriptCalls[2]).toContain("AXRaise");
    expect(osascriptCalls[2]).toContain("SomeApp");
    expect(osascriptCalls[2]).toContain("My Document");
  });

  it("does not restore focus if already in target app", async () => {
    const { execFile } = await import("node:child_process");
    (execFile as unknown as Mock).mockImplementation(makeMock(CLAUDE_SNAPSHOT));
    osascriptCalls.length = 0;

    await executeMacro("hello", { targetApp: "claude", submit: true });

    // Should NOT have a restoration call — only snapshot + paste.
    const restoreCalls = osascriptCalls.filter((s) =>
      s.includes("com.example.previous"),
    );
    expect(restoreCalls).toHaveLength(0);

    // Verify there are only 2 osascript calls: snapshot query + paste.
    expect(osascriptCalls).toHaveLength(2);
  });

  it("still resolves if focus restoration fails", async () => {
    const { execFile } = await import("node:child_process");
    let callIndex = 0;
    (execFile as unknown as Mock).mockImplementation(
      (
        cmd: string,
        argsOrCb?: string[] | ((err: Error | null, stdout?: string) => void),
        cb?: (err: Error | null, stdout?: string) => void,
      ) => {
        const callback = typeof argsOrCb === "function" ? argsOrCb : cb;
        const args = Array.isArray(argsOrCb) ? argsOrCb : [];

        if (cmd === "pbcopy") {
          const fakeStdin = {
            write: vi.fn(),
            end: vi.fn(() => callback?.(null)),
          };
          return { stdin: fakeStdin } as unknown as ChildProcess;
        }
        if (cmd === "osascript") {
          const script = args[1] ?? "";
          callIndex++;

          if (script.includes("bundle identifier of frontApp")) {
            callback?.(null, PREV_SNAPSHOT);
            return {} as ChildProcess;
          }
          // Second osascript: paste — succeed.
          // Third osascript: restore — fail.
          if (callIndex >= 3) {
            callback?.(new Error("activation failed"));
            return {} as ChildProcess;
          }
          callback?.(null, "");
          return {} as ChildProcess;
        }
        callback?.(null, "");
        return {} as ChildProcess;
      },
    );

    // Should resolve despite restore error (best-effort).
    await expect(executeMacro("hello")).resolves.toBeUndefined();
  });

  it("uses same paste sequence for Electron and native targets", async () => {
    await executeMacro("test", { targetApp: "cursor", submit: true });

    // Paste script should have standard 0.2s activation delay.
    const pasteScript = osascriptCalls.find((s) => s.includes('keystroke "v"'));
    expect(pasteScript).toBeDefined();
    expect(pasteScript).toContain("delay 0.2");
    // No Electron-specific focus hack — just activate + paste.
    expect(pasteScript).not.toContain("python3");
    expect(pasteScript).not.toContain("click at");
  });
});
