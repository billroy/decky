/**
 * Macro executor — platform router.
 *
 * Re-exports the same interface as the original macro-exec module.
 * On macOS (darwin), delegates to macro-exec-darwin.ts.
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

// Lazy-load darwin backend only when on macOS
let darwin: typeof import("./macro-exec-darwin.js") | null = null;
if (isDarwin) {
  darwin = await import("./macro-exec-darwin.js");
}

function unsupported(name: string): never {
  throw new Error(`${name} is not supported on ${process.platform}`);
}

export async function surfaceTargetApp(targetApp: TargetApp): Promise<void> {
  if (darwin) return darwin.surfaceTargetApp(targetApp);
  unsupported("surfaceTargetApp");
}

export async function executeMacro(text: string, options: MacroExecutionOptions = {}): Promise<void> {
  if (darwin) return darwin.executeMacro(text, options);
  unsupported("executeMacro");
}

export function approveOnceInClaude(): Promise<void> {
  if (darwin) return darwin.approveOnceInClaude();
  unsupported("approveOnceInClaude");
}

export function setApprovalAttemptLogger(logger: ApprovalAttemptLogger | null): void {
  if (darwin) return darwin.setApprovalAttemptLogger(logger);
  // No-op on unsupported platforms — logger has nothing to log
}

export async function withApprovalAttemptContext<T>(
  actionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (darwin) return darwin.withApprovalAttemptContext(actionId, fn);
  return fn();
}

export function dismissClaudeApproval(): Promise<void> {
  if (darwin) return darwin.dismissClaudeApproval();
  unsupported("dismissClaudeApproval");
}

export function startDictationForClaude(): Promise<void> {
  if (darwin) return darwin.startDictationForClaude();
  unsupported("startDictationForClaude");
}
