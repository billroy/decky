# Integration Remediation Plan

**Date:** 2026-03-10
**Branch:** `remediation/integration-cleanup`
**Goal:** Fix broken hook flow, clean up Codex integration, remove dead code, and establish a maintainable architecture.

---

## Context

The Decky bridge has accumulated architectural debt through organic growth:
- Dual approval flows (gate + mirror) that share a state machine but have incompatible semantics
- Codex integration that is default-on, spawning errors for Claude-only users
- Dead code from superseded plugin actions and a removed sqlite monitor
- The Codex `mirror→gate` default flip (commit `1b34cc7`) broke dual-UI display
- Type divergence between bridge and plugin packages
- No documentation of environment variable tunables

This plan remediates these issues in four 20-minute stages, each ending with passing tests and a commit.

---

## Design Imperatives

1. **Always load the Claude integration.** Claude is the primary target and must always be active.
2. **Load other integrations only when configured.** Codex (and future integrations) should only start if the user has buttons configured with `targetApp: "codex"` (or the config's `defaultTargetApp` is `"codex"`). This is safe because:
   - The config is loaded at startup before integrations initialize
   - Config reload already triggers `emitState()` — it can also trigger/stop integrations
   - No side effects from deferring Codex startup: the provider is self-contained and idempotent to start/stop
3. **Mirror-only for Claude hooks.** Remove gate flow from the default path. Gate flow code stays in the codebase but is clearly marked as legacy/opt-in via `DECKY_APPROVAL_FLOW=gate`.
4. **Clean up naming and dead code.** Remove sqlite-era naming, dead plugin actions, and stub functions.

---

## Stage 1: Fix hook default + config-driven integration loading (~20 min)

### 1a. Confirm hook fix (already done)
The `pre-tool-use.sh` default has been reverted to `mirror`. Verify the installed copy matches.

### 1b. Add `needsCodexIntegration()` helper to `app.ts`
Scan the loaded config to determine if Codex integration is needed:

```typescript
function needsCodexIntegration(cfg: DeckyConfig): boolean {
  if (cfg.defaultTargetApp === "codex") return true;
  return cfg.macros.some((m) => m.targetApp === "codex");
}
```

### 1c. Gate Codex startup behind config check
Replace the current unconditional startup:
```typescript
// Before (line 643):
const codexMonitorEnabled = !isTestRuntime && process.env.DECKY_ENABLE_CODEX_MONITOR !== "0";

// After:
const codexForceEnable = process.env.DECKY_ENABLE_CODEX_MONITOR === "1";
const codexForceDisable = process.env.DECKY_ENABLE_CODEX_MONITOR === "0";
const codexMonitorEnabled = !isTestRuntime && !codexForceDisable &&
  (codexForceEnable || needsCodexIntegration(getConfig()));
```

Logic:
- `DECKY_ENABLE_CODEX_MONITOR=1` — force on (override config)
- `DECKY_ENABLE_CODEX_MONITOR=0` — force off (override config)
- Not set — auto-detect from config (buttons with `targetApp: "codex"` or `defaultTargetApp: "codex"`)

### 1d. Log the integration loading decision
Add a clear startup log line:
```
[bridge] Claude integration: always loaded
[bridge] Codex integration: disabled (no codex buttons configured)
```
or:
```
[bridge] Codex integration: enabled (defaultTargetApp=codex)
```

### 1e. Update tests
- Add unit test for `needsCodexIntegration()` with cases: no codex buttons, one codex macro, defaultTargetApp=codex
- Update existing test that checks `codexMonitorEnabled` behavior

### Checkpoint
- Run `npm test` in bridge/
- Commit: "Gate Codex integration behind config — load only when buttons need it"

---

## Stage 2: Remove gate flow as default, clean up approval path (~20 min)

### 2a. Simplify `applyHookPayload` for hook-origin calls
When source is `"hook"` and flow is `"mirror"`, skip all gate file operations. The gate file path should only execute when `DECKY_APPROVAL_FLOW=gate` is explicitly set.

In `app.ts`, the `/hook` endpoint (line 875-878) currently defaults to `"gate"` when the header is not `"mirror"`:
```typescript
// Before:
const approvalFlow = ... ? "mirror" : "gate";

// After:
const approvalFlow = ... ? "mirror"
  : (typeof flowHeader === "string" && flowHeader.trim().toLowerCase() === "gate" ? "gate" : "mirror");
```
This makes the bridge default to mirror when no header is sent, matching the hook script default.

### 2b. Remove `clearGateFile()` call from non-gate flows
In `applyHookPayload`, the `clearGateFile()` call (line 549) should be conditional:
```typescript
if (flow === "gate") {
  clearGateFile();
}
```

### 2c. Add JSDoc comments marking gate flow as legacy
Add clear comments on `writeGateFile`, `clearGateFile`, and the gate polling branch in `pre-tool-use.sh`:
```
/** @deprecated Gate flow is legacy. Default is mirror. Set DECKY_APPROVAL_FLOW=gate to use. */
```

### 2d. Update tests
- Add test: mirror flow does NOT call `clearGateFile` or `writeGateFile`
- Add test: gate flow still works when explicitly requested via header
- Verify existing approval tests still pass

### Checkpoint
- Run `npm test` in bridge/
- Commit: "Default approval flow to mirror, gate is opt-in legacy"

---

## Stage 3: Remove dead code and fix naming (~20 min)

### 3a. Delete dead plugin action files
Remove these files from `plugin/src/actions/`:
- `approve.ts`
- `deny.ts`
- `cancel.ts`
- `status.ts`
- `approve-once.ts`
- `dictation.ts`

Verify none are imported in `plugin.ts` or any other live file.

### 3b. Remove `parseCodexIntegrationMode` stub
In `app.ts`:
- Delete the `CodexIntegrationMode` type (line 111)
- Delete the `parseCodexIntegrationMode` function (lines 192-195)
- Delete the `codexIntegrationMode` variable (line 644)
- Remove `mode: CodexIntegrationMode` from `StatePayload.codex` — replace with a hardcoded `mode: "app-server"` string in `statePayload()`

### 3c. Rename `HookSource` value
```typescript
// Before:
type HookSource = "hook" | "codex-monitor";

// After:
type HookSource = "hook" | "codex";
```
Update all references (the `source: "codex-monitor"` in the Codex hook event handler at line 757).

### 3d. Fix `approval.position` hardcoding
In `statePayload()` (line 410), replace `position: 1` with the actual position:
```typescript
position: approvalQueue.findIndex((item) => item.id === active.id) + 1,
```

### 3e. Fix double ENOENT error emission
In `codex-app-server-provider.ts`, the `child.on("error", ...)` handler should `return` after the ENOENT branch to avoid calling `onError` twice.

### 3f. Update tests
- Verify plugin builds without deleted action files
- Update any tests referencing `"codex-monitor"` source to `"codex"`
- Add test for correct `position` value with multiple queued approvals

### Checkpoint
- Run `npm test` in both bridge/ and plugin/
- Run `npm run build` in plugin/
- Commit: "Remove dead code, fix naming debt, fix position and ENOENT bugs"

---

## Stage 4: Sync types, handle stdin backpressure, document tunables (~20 min)

### 4a. Sync `Theme` type in plugin
In `plugin/src/bridge-client.ts`, add the missing theme values to match `bridge/src/config.ts`:
- Add: `"candy-cane"`, `"gradient-blue"`, `"wormhole"`, `"rainbow"`

In `plugin/src/layouts.ts`, ensure theme palette handling has a fallback for unknown themes (it should already default to `"light"` palette, but verify).

### 4b. Fix `sendMessage()` backpressure in codex provider
In `codex-app-server-provider.ts`, change `sendMessage()` to handle write failures:
```typescript
private sendMessage(message: Record<string, unknown>): boolean {
  const payload = `${JSON.stringify(message)}\n`;
  if (!this.process || this.process.stdin.destroyed) {
    throw new Error("codex app-server transport unavailable");
  }
  const ok = this.process.stdin.write(payload);
  if (!ok) {
    this.onDebugLog?.("stdin backpressure — write buffered but may be delayed");
  }
  return ok;
}
```
Also wire up `stdin.on("error", ...)` in the `start()` method to call `this.onError`.

### 4c. Make Codex auto-resume opt-in
Change `app.ts` line 646:
```typescript
// Before:
const codexAutoResumeCwd = process.env.DECKY_CODEX_AUTO_RESUME === "0" ? null : process.cwd();

// After:
const codexAutoResumeCwd = process.env.DECKY_CODEX_AUTO_RESUME === "1"
  ? (process.env.DECKY_CODEX_CWD || process.cwd())
  : null;
```

### 4d. Add environment variable reference
Add a `## Environment Variables` section to this file for handoff reference:

| Variable | Default | Description |
|----------|---------|-------------|
| `DECKY_BRIDGE_URL` | `http://localhost:9130` | Bridge server URL (used by hooks) |
| `DECKY_APPROVAL_FLOW` | `mirror` | Approval flow: `mirror` (default, non-blocking) or `gate` (legacy, blocking) |
| `DECKY_TIMEOUT` | `30` | Gate flow polling timeout in seconds |
| `DECKY_ENABLE_CODEX_MONITOR` | auto | `1` force-enable, `0` force-disable, unset = auto from config |
| `DECKY_CODEX_APP_SERVER_COMMAND` | `codex` | Path to codex binary |
| `DECKY_CODEX_AUTO_RESUME` | `0` (off) | `1` to enable auto-resume of Codex threads |
| `DECKY_CODEX_CWD` | `process.cwd()` | Working directory for auto-resume thread matching |
| `DECKY_CODEX_RESTART_MAX_ATTEMPTS` | `3` | Max restart attempts for Codex provider |
| `DECKY_CODEX_RESTART_BASE_DELAY_MS` | `350` | Base delay for exponential backoff |
| `DECKY_CODEX_RESTART_MAX_DELAY_MS` | `4000` | Max delay cap for exponential backoff |
| `DECKY_HOOK_DEBUG` | `0` | `1` to enable hook script debug logging to stderr |
| `DECKY_HOME` | `~/.decky` | Override Decky data directory |

### 4e. Update tests
- Test `sendMessage` with a mock that returns `false` from `write()`
- Test auto-resume is disabled by default (no `DECKY_CODEX_AUTO_RESUME`)
- Verify theme type sync doesn't break plugin build

### Checkpoint
- Run `npm test` in both bridge/ and plugin/
- Run `npm run build` in plugin/
- Commit: "Sync types, fix stdin backpressure, document env vars, auto-resume opt-in"

---

## Files Modified Per Stage

### Stage 1
- `bridge/src/app.ts` — add `needsCodexIntegration()`, gate Codex startup
- `bridge/src/__tests__/` — new/updated tests
- `hooks/pre-tool-use.sh` — verify mirror default (already done)

### Stage 2
- `bridge/src/app.ts` — default `/hook` endpoint to mirror, conditional gate file ops
- `bridge/src/__tests__/` — new/updated tests

### Stage 3
- `plugin/src/actions/approve.ts` — DELETE
- `plugin/src/actions/deny.ts` — DELETE
- `plugin/src/actions/cancel.ts` — DELETE
- `plugin/src/actions/status.ts` — DELETE
- `plugin/src/actions/approve-once.ts` — DELETE
- `plugin/src/actions/dictation.ts` — DELETE
- `bridge/src/app.ts` — remove stubs, rename source, fix position
- `bridge/src/codex-app-server-provider.ts` — fix ENOENT double-emit
- `bridge/src/__tests__/` — updated tests
- `plugin/src/__tests__/` — updated tests (if any reference deleted actions)

### Stage 4
- `plugin/src/bridge-client.ts` — sync Theme type
- `bridge/src/codex-app-server-provider.ts` — stdin backpressure handling
- `bridge/src/app.ts` — auto-resume opt-in
- `bridge/src/__tests__/` — new tests
- This file — env var reference table

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DECKY_BRIDGE_URL` | `http://localhost:9130` | Bridge server URL (used by hooks) |
| `DECKY_APPROVAL_FLOW` | `mirror` | Approval flow: `mirror` (default, non-blocking) or `gate` (legacy, blocking) |
| `DECKY_TIMEOUT` | `30` | Gate flow polling timeout in seconds |
| `DECKY_ENABLE_CODEX_MONITOR` | auto | `1` force-enable, `0` force-disable, unset = auto from config |
| `DECKY_CODEX_APP_SERVER_COMMAND` | `codex` | Path to codex binary |
| `DECKY_CODEX_AUTO_RESUME` | `0` (off) | `1` to enable auto-resume of Codex threads |
| `DECKY_CODEX_CWD` | `process.cwd()` | Working directory for auto-resume thread matching |
| `DECKY_CODEX_RESTART_MAX_ATTEMPTS` | `3` | Max restart attempts for Codex provider |
| `DECKY_CODEX_RESTART_BASE_DELAY_MS` | `350` | Base delay for exponential backoff |
| `DECKY_CODEX_RESTART_MAX_DELAY_MS` | `4000` | Max delay cap for exponential backoff |
| `DECKY_HOOK_DEBUG` | `0` | `1` to enable hook script debug logging to stderr |
| `DECKY_HOME` | `~/.decky` | Override Decky data directory |

---

## Handoff Notes for New Session

1. **Start by reading this file** and the project memory at `/Users/bill/.claude/projects/-Users-bill-aistuff-decky/memory/MEMORY.md`
2. **Create branch** `remediation/integration-cleanup` from current HEAD
3. **Work through stages 1-4 sequentially** — each stage is ~20 min with tests + commit
4. **The hook fix (mirror default) is already applied** in the working tree — Stage 1a is just verification
5. **Key files to understand first:** `bridge/src/app.ts` (1338 lines, central hub), `bridge/src/config.ts` (config structure), `bridge/src/codex-app-server-provider.ts` (1013 lines, Codex transport)
6. **Run tests with:** `cd bridge && npm test` and `cd plugin && npm test`
7. **Build plugin with:** `cd plugin && npm run build`
8. **After all 4 stages**, create a PR to main with the summary from this document
