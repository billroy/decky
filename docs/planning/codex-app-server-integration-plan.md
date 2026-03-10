# Codex Integration Migration Plan (SQLite -> App Server)

Date: 2026-03-10  
Status: In progress (approved to start)  
Scope: Codex integration only. Claude integration remains unchanged.

## Current implementation status (2026-03-10)

Implemented in this branch:
- App Server provider/session scaffolding (`CodexAppServerProvider`, `CodexAppServerSession`).
- JSON-RPC request correlation by request ID with queue-safe public request IDs.
- Decision routing primitives for approve/deny/cancel responses (v2 + legacy request methods).
- Bridge integration now runs App Server only in runtime; SQLite integration path is disabled.
- App Server command defaults to bundled Codex app binary path when present, then falls back to `codex` on PATH.
- Mirror-flow action routing now requires App Server request correlation in `app-server` mode; missing request IDs fail fast instead of falling back to UI automation.
- Unit tests for App Server helper/session behavior.

Still open before full cutover:
- Production validation against real Codex App Server runtime and lifecycle edge cases.
- Session ownership policy (`single active` enforced behavior and multi-session handling).
- Final fail-open/fail-closed behavior confirmation for provider disconnect scenarios.
- Soak validation before deleting remaining unused SQLite code/modules.

## Context

Current Codex integration infers approval lifecycle by polling Codex local SQLite logs and mapping log strings to Decky hook-like events.

Current implementation points:
- Polling parser: `/Users/bill/aistuff/decky/bridge/src/codex-monitor.ts`
- Monitor wiring: `/Users/bill/aistuff/decky/bridge/src/app.ts` (Codex monitor setup and mirrored hook ingestion)
- Approval action routing: `/Users/bill/aistuff/decky/bridge/src/app.ts` (mirror approval dispatch / settlement)

Pain points:
- Fragile string parsing and event inference.
- Event ordering edge cases (current whack-a-mole behavior).
- Coupling to internal log schema and DB file behavior.

## Goal

Replace SQLite log polling with the official Codex App Server event/approval channel so Decky receives explicit approval events and sends explicit approval responses.

## Non-goals

- No Claude hook migration in this workstream.
- No UI redesign outside behavior required for Codex lifecycle reliability.
- No provider-wide approval lifecycle generalization in this phase.

## Proposed Architecture

1. Introduce provider adapter boundary in bridge:
   - `CodexProvider` interface for:
     - `start() / stop()`
     - event stream subscription
     - `approve(requestId)` / `deny(requestId)` / `cancel(requestId)` (or equivalent)
   - Two implementations:
     - `CodexSqliteProvider` (existing behavior, temporary fallback)
     - `CodexAppServerProvider` (new default target)

2. Move from inferred to correlated approvals:
   - Use Codex request IDs from App Server approval events.
   - Persist active and queued requests by request ID (not just inferred tool/state).
   - Use request ID when sending user decisions back to Codex.

3. Keep Decky state model stable:
   - Continue emitting normalized state snapshots to plugin.
   - Internally map App Server events into existing bridge lifecycle transitions.

4. Runtime mode is App Server only:
   - SQLite runtime path is disabled.
   - `DECKY_CODEX_INTEGRATION=sqlite` is ignored with a warning.

## Implementation Plan

### Phase 0: Contract Lock + Test Harness

Deliverables:
- Define normalized Codex event contract used inside bridge.
- Add fixture-driven parser tests for App Server event payloads (approval request, approval resolved, turn/task completion, disconnect/reconnect).
- Add fake Codex App Server harness for integration tests.

Exit criteria:
- Deterministic tests proving event->state mapping and approval correlation by request ID.

### Phase 1: App Server Read Path (Observe-Only)

Deliverables:
- Implement `CodexAppServerProvider` receive path only.
- Mirror App Server events into debug endpoints without driving approval actions yet.
- Compare mode remains optional diagnostics only and is not part of runtime decision flow.

Exit criteria:
- No unexplained divergences in targeted scenarios:
  - single approval
  - chained approvals
  - approve/deny/cancel
  - reconnect mid-run

### Phase 2: App Server Write Path (Decision Routing)

Deliverables:
- Route Stream Deck approve/deny/cancel for Codex to App Server decision API using request IDs.
- Keep existing mirror-settlement timeout safeguards while App Server path is proving out.
- Fail fast when App Server request correlation is missing (no UI/sqlite fallback).

Exit criteria:
- End-to-end Codex approval flows pass via App Server without SQLite participation.
- No stuck `awaiting-approval` in repeated stress runs.

### Phase 3: Hardening + Diagnostics

Deliverables:
- Keep runtime App Server-only and improve operator visibility.
- Expand diagnostics:
  - active request IDs
  - queue depth
  - provider connectivity state
  - last N provider events

Exit criteria:
- Soak period passes (manual + automated) with no P1 reliability regressions.

### Phase 4: SQLite Retirement

Deliverables:
- Remove SQLite-specific parser/polling code and associated tests.
- Remove related env flags/docs.

Exit criteria:
- Single supported Codex integration path (App Server) with stable tests and docs.

## Open Issues / Decisions Needed

1. App Server transport/runtime details
- Confirm exact process lifecycle and invocation model Decky should own.
- Confirm reconnect semantics and heartbeat strategy.

2. Approval API surface stability
- Confirm request/response schema versioning and compatibility expectations.
- Define behavior when request IDs expire or become invalid.

3. Session/thread scoping
- Determine whether Decky should track one active Codex session or multiple.
- Define policy when multiple concurrent sessions emit approval requests.

4. Error semantics
- Decide fail-open vs fail-closed for Codex App Server disconnect during pending approvals.
- Define retry/backoff and user-visible error strategy.

5. Fallback policy
- Decide when to auto-fallback to SQLite (if ever) versus requiring explicit operator switch.

6. Tool labeling
- Confirm reliable source of tool display label in App Server events.
- Define fallback label strategy when tool metadata is missing.

7. Security model
- Confirm local trust boundary for App Server transport and permissions.
- Confirm any token/secret handling requirements for local bridge integration.

## Test Plan (Required)

- Unit:
  - App Server event parsing/mapping
  - request ID correlation and queue handling
  - retry/reconnect state behavior

- Integration:
  - simulated App Server with deterministic sequences
  - approve/deny/cancel under queue pressure
  - disconnect/reconnect during pending approval

- Regression:
  - existing bridge approval workflow tests
  - plugin rendering/tests for approval metadata and queue display

## Rollout Controls

- Feature flag: `DECKY_CODEX_INTEGRATION`
- Debug endpoint enrichment for provider and queue visibility
- One-release fallback window before SQLite removal

## Proposed Approval Checklist

- [ ] Accept architecture direction (App Server default target, SQLite temporary fallback)
- [ ] Accept fail behavior on provider disconnect (choose fail-open or fail-closed)
- [ ] Accept multi-session policy (single active vs multi-session queueing)
- [ ] Accept phased rollout and deprecation timeline

## Sources

- Claude hooks docs (for contrast and current decision): https://code.claude.com/docs/en/hooks
- Codex App Server docs: https://developers.openai.com/codex/app-server
- Codex config reference: https://developers.openai.com/codex/config-reference
- Codex approvals/security: https://developers.openai.com/codex/agent-approvals-security
