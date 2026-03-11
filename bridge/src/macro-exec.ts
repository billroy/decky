/**
 * Macro executor — platform router.
 *
 * Re-exports the same interface as the original macro-exec module.
 * On macOS (darwin), delegates to macro-exec-darwin.ts.
 * On Windows (win32), delegates to macro-exec-win32.ts.
 * On other platforms, functions throw "not supported" errors.
 *
 * All test files that `vi.mock("../macro-exec.js")` continue to work
 * because this file has the same module path.
 */

import type { TargetApp } from "./config.js";

interface MacroExecutionOptions {
  targetApp?: TargetApp;
  submit?: boolean;
}

type ApprovalAttemptLogger = (attempt: {
  contextId: string | null;
  phase: string;
  strategy: string;
  targetApp: string;
  hostApp: string;
  success: boolean;
  detail?: string;
  error?: string;
}) => void;

const isDarwin = process.platform === "darwin";
const isWin32 = process.platform === "win32";

// Lazy-load platform backends — only the matching platform loads
let darwin: typeof import("./macro-exec-darwin.js") | null = null;
let win32: typeof import("./macro-exec-win32.js") | null = null;

if (isDarwin) {
  darwin = await import("./macro-exec-darwin.js");
} else if (isWin32) {
  win32 = await import("./macro-exec-win32.js");
}

function unsupported(name: string): never {
  throw new Error(`${name} is not supported on ${process.platform}`);
}

export async function surfaceTargetApp(targetApp: TargetApp): Promise<void> {
  if (darwin) return darwin.surfaceTargetApp(targetApp);
  if (win32) return win32.surfaceTargetApp(targetApp);
  unsupported("surfaceTargetApp");
}

export async function executeMacro(text: string, options: MacroExecutionOptions = {}): Promise<void> {
  if (darwin) return darwin.executeMacro(text, options);
  if (win32) return win32.executeMacro(text, options);
  unsupported("executeMacro");
}

export function approveOnceInClaude(): Promise<void> {
  if (darwin) return darwin.approveOnceInClaude();
  if (win32) return win32.approveOnceInClaude();
  unsupported("approveOnceInClaude");
}

export function setApprovalAttemptLogger(logger: ApprovalAttemptLogger | null): void {
  if (darwin) return darwin.setApprovalAttemptLogger(logger);
  if (win32) return win32.setApprovalAttemptLogger(logger);
  // No-op on unsupported platforms — logger has nothing to log
}

export async function withApprovalAttemptContext<T>(
  actionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (darwin) return darwin.withApprovalAttemptContext(actionId, fn);
  if (win32) return win32.withApprovalAttemptContext(actionId, fn);
  return fn();
}

export function dismissClaudeApproval(): Promise<void> {
  if (darwin) return darwin.dismissClaudeApproval();
  if (win32) return win32.dismissClaudeApproval();
  unsupported("dismissClaudeApproval");
}

export function startDictationForClaude(): Promise<void> {
  if (darwin) return darwin.startDictationForClaude();
  if (win32) return win32.startDictationForClaude();
  unsupported("startDictationForClaude");
}
