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

vi.mock("node:child_process", () => {
  return {
    execFile: vi.fn(
      (
        cmd: string,
        argsOrCb?: string[] | ((err: Error | null, stdout?: string) => void),
        cb?: (err: Error | null, stdout?: string) => void,
      ) => {
        const callback =
          typeof argsOrCb === "function" ? argsOrCb : cb;
        const args = Array.isArray(argsOrCb) ? argsOrCb : [];

        if (cmd === "pbcopy") {
          // Simulate pbcopy succeeding after stdin ends.
          const fakeStdin = {
            write: vi.fn(),
            end: vi.fn(() => {
              // pbcopy "finishes" synchronously for test purposes.
              callback?.(null);
            }),
          };
          return { stdin: fakeStdin } as unknown as ChildProcess;
        }

        if (cmd === "osascript") {
          const script = args[1] ?? "";
          osascriptCalls.push(script);

          // getFrontmostBundleId queries — return a known bundle ID.
          if (script.includes("bundle identifier of frontApp")) {
            callback?.(null, "com.example.previous");
            return {} as ChildProcess;
          }

          // Any other osascript call (activation, paste, restore) succeeds.
          callback?.(null, "");
          return {} as ChildProcess;
        }

        // Unknown command — succeed.
        callback?.(null, "");
        return {} as ChildProcess;
      },
    ),
  };
});

// Import after mocks are installed.
const { executeMacro } = await import("../macro-exec.js");

beforeEach(() => {
  osascriptCalls.length = 0;
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeMacro quick-focus-steal", () => {
  it("restores focus to previous app after injection", async () => {
    await executeMacro("hello", { targetApp: "claude", submit: true });

    // Should have at least 3 osascript calls:
    // 1. getFrontmostBundleId
    // 2. activation + paste + submit
    // 3. restore previous app
    expect(osascriptCalls.length).toBeGreaterThanOrEqual(3);

    // First call: getFrontmostBundleId
    expect(osascriptCalls[0]).toContain("bundle identifier of frontApp");

    // Second call: activates Claude and pastes
    expect(osascriptCalls[1]).toContain("com.anthropic.claudefordesktop");
    expect(osascriptCalls[1]).toContain('keystroke "v" using command down');

    // Third call: restores the previous app
    expect(osascriptCalls[2]).toContain("com.example.previous");
  });

  it("does not restore focus if already in target app", async () => {
    // Override the mock to return Claude's own bundle ID as frontmost.
    const { execFile } = await import("node:child_process");
    (execFile as unknown as Mock).mockImplementation(
      (
        cmd: string,
        argsOrCb?: string[] | ((err: Error | null, stdout?: string) => void),
        cb?: (err: Error | null, stdout?: string) => void,
      ) => {
        const callback =
          typeof argsOrCb === "function" ? argsOrCb : cb;
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

          if (script.includes("bundle identifier of frontApp")) {
            // Already in Claude — same as target.
            callback?.(null, "com.anthropic.claudefordesktop");
            return {} as ChildProcess;
          }
          callback?.(null, "");
          return {} as ChildProcess;
        }
        callback?.(null, "");
        return {} as ChildProcess;
      },
    );
    osascriptCalls.length = 0;

    await executeMacro("hello", { targetApp: "claude", submit: true });

    // Should NOT have a restoration call — only getFrontmostBundleId + paste.
    const restoreCalls = osascriptCalls.filter((s) =>
      s.includes("com.example.previous"),
    );
    expect(restoreCalls).toHaveLength(0);

    // Verify there are only 2 osascript calls: query + paste.
    expect(osascriptCalls).toHaveLength(2);
  });

  it("still resolves if focus restoration fails", async () => {
    // Override to make the restore call throw.
    const { execFile } = await import("node:child_process");
    let callIndex = 0;
    (execFile as unknown as Mock).mockImplementation(
      (
        cmd: string,
        argsOrCb?: string[] | ((err: Error | null, stdout?: string) => void),
        cb?: (err: Error | null, stdout?: string) => void,
      ) => {
        const callback =
          typeof argsOrCb === "function" ? argsOrCb : cb;
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
            callback?.(null, "com.example.previous");
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
});
