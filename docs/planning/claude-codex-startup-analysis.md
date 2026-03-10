# Codex Integration Startup Analysis

Technical review of the Codex app-server integration feature area, focused on
startup reliability and early-test failure modes.

## Architecture Summary

The Codex integration spawns Codex's `app-server` as a child process,
communicates over stdio using JSON-RPC, and maps Codex approval requests into
Decky's existing state machine. Approval decisions flow back from the
StreamDeck through the bridge to the spawned process.

> Reviewer comment (2026-03-10): Accurate high-level summary. Current implementation is app-server only (sqlite path is force-disabled in `app.ts`), and this analysis is still the right frame for startup reliability work.

## Likely Startup Failure Causes

### 1. `start()` returns true before process is confirmed alive (P0)

`codex-app-server-provider.ts:501-561` — `start()` calls `spawn()`
synchronously and immediately returns `true` at line 553. The
`child.on("error", ...)` callback fires *after* `start()` resolves, so the
caller at `app.ts:576` sees `started === true` and logs "connected" even
though the process may never have actually started.

If the codex binary is missing (`ENOENT`), `start()` still returns `true`.

**Fix:** Wait for the handshake response (or at minimum the first stdout line)
before resolving. Add a startup timeout (e.g., 5 seconds).

> Reviewer comment (2026-03-10): Still valid and still P0. Current `start()` (`bridge/src/codex-app-server-provider.ts:501-553`) returns `true` immediately after `spawn()` and handshake send, without waiting for initialize response.

### 2. No handshake timeout (P0)

After spawn, `session.startHandshake()` (line 552) sends an `initialize`
JSON-RPC request to the child's stdin. If the codex binary starts but doesn't
respond (wrong subcommand, wrong version, or non-JSON stdout), the session
silently hangs forever. There is no timeout or fallback.

**Fix:** Add a `setTimeout` in `startHandshake()` that calls `onError()` +
`stop()` if no `initialize` response arrives within N seconds.

> Reviewer comment (2026-03-10): Still valid and still P0. `startHandshake()` only sends initialize; no watchdog/timer exists in session or provider.

### 3. Fire-and-forget startup in `app.ts` (P1)

At `app.ts:576`, `codexMonitor.start()` is called with `void`
(fire-and-forget):

```typescript
void codexMonitor.start().then((started) => { ... });
```

The bridge server continues initializing and serving clients before knowing
whether Codex actually connected. If a StreamDeck action arrives before the
handshake completes, approval resolution will fail.

**Fix:** Await Codex readiness before advertising codex approval support, or
at minimum defer `resolveCodexApproval` assignment until handshake completes.

> Reviewer comment (2026-03-10): Partially valid. Startup is still fire-and-forget (`void codexMonitor.start().then(...)`), so readiness is still optimistic. However, assigning `resolveCodexApproval` early is less risky than stated because approvals come from app-server requests and include request correlation; if there is no pending correlated request, actions fail fast.

### 4. Codex binary not found

`codex-app-server-provider.ts:84-89` — `resolveDefaultCodexAppServerCommand()`
checks for `/Applications/Codex.app/Contents/Resources/codex`, then falls back
to `codex` on PATH. If neither exists, `spawn()` emits an `ENOENT` error
asynchronously. Combined with issue #1, this means the error is only observed
as a delayed warning log that is easy to miss.

> Reviewer comment (2026-03-10): Still valid. Out-of-box defaults are improved (app bundle path first), but ENOENT remains asynchronous and coupled to issue #1.

### 5. Approval resolution before handshake

`resolveCodexApproval` is assigned immediately at `app.ts:574` but the Codex
process may not be ready. If an approval request arrives (from the `/hook`
endpoint via Claude's hooks) before handshake, the session tries to write to a
possibly-dead stdin. `sendMessage()` at line 601 silently returns if stdin is
destroyed, so the approval response is silently lost.

> Reviewer comment (2026-03-10): Needs refinement. The larger practical risk now is transport readiness/health drift (process exits, stdin destroyed) rather than "before handshake". Silent drop in `sendMessage()` is still a real correctness gap because callers receive no rejection when writes are skipped.

## Design Issues

### 6. No process lifecycle monitoring / reconnect (P1)

If the Codex process crashes mid-session (`exit` event at line 541), the error
handler logs a warning but takes no corrective action. The bridge continues
running with `this.process = null`, silently dropping all future approval
resolutions. There is no restart or reconnect logic.

**Fix:** Add basic restart logic with backoff (e.g., 3 retries with
exponential backoff).

> Reviewer comment (2026-03-10): Still valid and still P1. Current behavior logs and stops; no reconnect supervisor exists.

### 7. Orphaned approvalQueue on process death (P1)

When the process exits, `session.stop()` at line 544 clears internal pending
maps. But the bridge's `approvalQueue` in `app.ts` still holds the queued
approval items. The state machine can remain stuck in `awaiting-approval` with
no way to resolve — the StreamDeck shows a pending approval with no process to
send the decision to.

**Fix:** When the process exits, emit a cleanup event that forces the state
machine back to `idle` and drains the queue.

> Reviewer comment (2026-03-10): Mostly valid. We now have better source-aware queue draining for hook/codex events, but provider death still does not trigger codex-specific queue cleanup. This remains a production hazard.

### 8. ENOENT error is logged twice (P2)

At lines 520-526, the ENOENT case calls `this.onError(new Error(...))` with a
descriptive message, then *unconditionally* calls `this.onError(error)` again
with the raw error. This produces confusing double error output.

**Fix:** Add `return` after the ENOENT-specific error, or use `else`.

> Reviewer comment (2026-03-10): Still valid. Current handler still emits both wrapped and raw errors for ENOENT.

### 9. No protocol version validation (P2)

The `initialize` response from Codex (`handleResponse` at line 310) doesn't
check `serverInfo` or protocol version. If the installed Codex version uses
different approval methods or notification formats, things fail silently.

**Fix:** Validate `serverInfo` in the `initialize` response; warn if
unexpected.

> Reviewer comment (2026-03-10): Direction is valid, but schema nuance: current initialize response appears to include `userAgent` rather than strongly-typed `serverInfo`. Action should be framed as "capability/protocol compatibility validation", not only `serverInfo` key checks.

### 10. Auto-resume has no opt-out feedback

`autoResumeCwd` defaults to `process.cwd()` (`app.ts:531`). After handshake,
the session immediately starts scanning and resuming threads. If the Codex
API's `thread/loaded/list` or `thread/list` endpoints don't exist in the
installed version, the error is logged but there's no user-visible indication
that auto-resume failed.

> Reviewer comment (2026-03-10): Partially addressed. Auto-resume strategy was improved (loaded-thread preference + fallbacks), but user-facing health/status for auto-resume success/failure is still missing.

### 11. Dead code: codex compare infrastructure (P3)

`codexCompareEnabled` is hardcoded to `false` at `app.ts:529`. The compare
event types and recording functions (`CodexCompareEvent`,
`CodexCompareDivergence`, `recordCodexCompareEvent`) are dead code.

> Reviewer comment (2026-03-10): Still valid. Keeping this disabled code path is low-risk but adds cognitive load and should be either feature-flagged properly or removed.

### 12. Legacy `CodexMonitor` class still shipped (P3)

`codex-monitor.ts` (SQLite polling) is fully deprecated — `app.ts:168-169`
forces `app-server` mode even when `sqlite` is requested. The class and its
tests could be removed to reduce surface area.

> Reviewer comment (2026-03-10): Still valid. This is now tech debt and should be removed in a cleanup phase once no callers/tests depend on it.

## Priority Summary

| Priority | Issue | Key File:Line |
|----------|-------|---------------|
| P0 | `start()` returns true before process confirmed alive | `codex-app-server-provider.ts:501-553` |
| P0 | No handshake timeout | `codex-app-server-provider.ts:228-239` |
| P1 | Fire-and-forget startup | `app.ts:576` |
| P1 | No reconnect on crash | `codex-app-server-provider.ts:541-549` |
| P1 | Orphaned approvalQueue on process death | `app.ts` approvalQueue vs `session.stop()` |
| P2 | Double ENOENT error logging | `codex-app-server-provider.ts:520-526` |
| P2 | No protocol version check | `codex-app-server-provider.ts:310-319` |
| P3 | Dead code: compare infrastructure | `app.ts:529, 132-147` |
| P3 | Legacy CodexMonitor still shipped | `codex-monitor.ts` |

## Most Probable Root Cause

The most likely reason the Codex integration is "not starting correctly" is a
combination of issues 1, 2, and 3: the binary either isn't found or doesn't
complete the JSON-RPC handshake, but `start()` returns `true` regardless, and
the caller doesn't await confirmation. The system logs "connected" prematurely
while errors only appear later as async warnings that are easy to miss.

Adding a handshake timeout and making `start()` only resolve `true` after a
successful `initialize` response would address the immediate failure mode.

> Reviewer comment (2026-03-10): Agreed for startup reliability. In recent failures we also observed a second root cause class: cross-source queue contamination from hook-origin mirror events. That part has now been partially mitigated with source-aware queue draining.

## Phased Implementation Plan

### Phase 0 - Startup Correctness Gate (P0)

Goal: make "connected" mean actually ready.

1. Introduce explicit provider readiness state (`starting`, `ready`, `failed`, `stopped`) in `CodexAppServerProvider`.
2. Change `start()` to resolve `true` only after successful initialize response; resolve `false` on spawn/handshake failure.
3. Add handshake timeout (for example 5 seconds) and fail startup if initialize response is not received in time.
4. Add startup integration tests:
   - binary missing (`ENOENT`) returns failure
   - initialize never returns triggers timeout failure
   - valid initialize returns success

Exit criteria:
- No log line indicates "connected" before handshake success.
- Startup failure is deterministic and user-visible.

### Phase 1 - Runtime Resilience and Recovery (P1)

Goal: avoid wedged approvals after runtime process failures.

1. Add restart supervisor with bounded retries and backoff (for example 3 retries with jitter).
2. Emit provider lifecycle events (`onReady`, `onExit`, `onFatal`) to app layer.
3. On provider exit/fatal:
   - clear codex-origin pending approvals
   - force state transition out of `awaiting-approval` when no active request can be served
   - emit explicit socket error/status update.
4. Make `sendMessage()` fail loudly when process/stdin is unavailable (propagate to caller).

Exit criteria:
- Killing `codex app-server` does not leave Decky stuck in `awaiting-approval`.
- Approve/deny/cancel actions return explicit errors if transport is unavailable.

### Phase 2 - Protocol and Compatibility Hardening (P1/P2)

Goal: detect version/protocol mismatches early and provide diagnostics.

1. Validate initialize result shape and required capabilities for approval methods/notifications.
2. Add compatibility checks for required RPC methods (`thread/loaded/list`, `thread/list`, `thread/resume`, approval methods).
3. Surface compatibility status via `/status` and `/debug` endpoints (not just logs).
4. Add structured auto-resume diagnostics (selected thread id, reason, fallback path, last error).

Exit criteria:
- Unsupported app-server versions fail with actionable diagnostics.
- Auto-resume behavior is inspectable without reading raw logs.

### Phase 3 - Surface Area Reduction and Cleanup (P3)

Goal: remove obsolete paths that repeatedly create confusion.

1. Remove deprecated sqlite monitor code (`codex-monitor.ts`) and associated tests/docs.
2. Remove or properly feature-gate codex compare dead code.
3. Update docs to reflect app-server-only architecture and current approval flow.

Exit criteria:
- No sqlite monitor code paths remain in production runtime.
- Bridge code reflects a single integration strategy with minimal dead branches.
