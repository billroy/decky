# PI Automated UI Coverage Gap-Closure Plan

## Scope and Requirement (Restated)
Original requirement: automated, closed-loop verification that **every Property Inspector control** drives the expected plugin/bridge update and visible PI/UI reaction, without manual Stream Deck clicking.

This means tests must validate, per control:
1. UI interaction occurs in PI
2. PI emits correct outbound update message
3. plugin/bridge accepts or rejects deterministically
4. PI renders correct success/error state
5. resulting state is reflected in subsequent snapshot/render

## Assessment: `docs/planning/pi-test-strategy-codex.md`
Verdict: **closest to requirement, but not sufficient as written**.

What it gets right:
- Correctly prioritizes real-browser closed-loop testing via Playwright + mock WS
- Defines control coverage tiers and matrix
- Preserves shipping reality (tests real PI HTML before refactor)
- Includes save/ack/error path coverage

Gaps:
- Ack model still assumes `configSnapshot` ack in places; should require explicit `updateConfigAck/updateConfigError` protocol checks first, then snapshot reconciliation checks
- Does not define deterministic assertions for deck icon render reaction (plugin `setImage`/render path)
- Lacks strict traceability requirement: each PI control mapped to at least one explicit test id
- No explicit gating policy (PR must fail if any control lacks test)
- No migration path for existing vitest-only suites to coexist with Playwright in CI matrix

## Assessment: `docs/planning/pi-test-strategy.md`
Verdict: **good architecture direction, incomplete on executable path**.

What it gets right:
- Correct layered strategy (PI logic, protocol, integration, optional desktop smoke)
- Correctly requires explicit ack/error protocol and payload correlation
- Good coverage matrix and required assertions

Gaps:
- More conceptual than implementation-ready
- Depends on PI script extraction as a major step; that delays test value
- Missing concrete filesystem/test harness structure and command wiring
- Does not define exact pass criteria for “every control covered” enforcement

## Assessment: Current Implemented Tests (this branch)
Verdict: **not meeting original objective yet**.

Implemented:
- Bridge emits explicit `updateConfigAck` / `updateConfigError`
- Plugin bridge client receives ack/error events
- PI uses request-correlated ack/error flow for Apply state handling
- Targeted tests for ack/error contract paths

Missing versus objective:
- No Playwright PI suite
- No per-control DOM interaction tests
- No end-to-end PI->plugin->bridge->PI closed-loop tests across full control matrix
- No deck render reaction assertions for control changes

## Updated Forward Proposal

### Phase 0: Stabilize Protocol Contract (short)
- Finalize protocol schema for:
  - `updateConfig` (with `requestId`)
  - `updateConfigAck`
  - `updateConfigError`
  - `configSnapshot`
- Add schema-based contract tests in bridge/plugin.
- Acceptance:
  - malformed payloads rejected with explicit error
  - requestId correlation proven in tests

### Phase 1: Build PI Closed-Loop Harness (Playwright + mock Stream Deck WS)
- Add Playwright and `ws` under `plugin/`
- Implement mock Stream Deck websocket server fixture
- Load actual `property-inspector-v2.html` via `file://`
- Drive `connectElgatoStreamDeckSocket(...)` handshake
- Provide helper APIs:
  - `sendSnapshot(config)`
  - `waitForUpdateConfig()`
  - `sendAck(requestId)` / `sendError(requestId, code)`
- Acceptance:
  - one smoke test passes full update cycle

### Phase 2: Exhaustive PI Control Coverage (required)
Create spec files with one or more tests per control class:
- Global controls
  - Theme selector + apply modes
  - Timeout input
  - Target badge checkbox
  - Apply button enable/disable logic
- Selected macro controls
  - Label/text/icon/target app
  - selected-target dropdown behavior
- Color controls
  - Page bg/text/icon
  - Per-macro bg/text/icon
  - Reset page defaults
  - Reset all overrides
- Macro list controls
  - add/remove/reorder/scope toggle
- Error and recovery controls
  - ack timeout
  - updateConfigError path
  - retry success path

For every test:
- Assert outbound payload diff
- Assert ack/error handling state
- Assert post-ack snapshot-rendered values in controls

### Phase 3: Plugin Render-Reaction Assertions (required for “UI reaction”)
- Add test seam/mocks around `slot.ts` render pipeline
- Validate control changes that should affect icon rendering actually trigger rerender path
- Assert expected render metadata (title/icon colors/target badge state), not just config persistence

### Phase 4: CI Gating and Coverage Enforcement
- Add `test:pi` and include in PR checks
- Add a control coverage manifest (`docs/planning/pi-control-coverage-map.json`)
  - each control id -> test file/test id
- Add CI check that fails if any control id has no mapped test
- Optional nightly desktop smoke suite remains non-blocking

## Control Coverage Traceability Requirement
Add a control inventory file with stable IDs, e.g.:
- `theme.selector`
- `theme.applyMode.keep`
- `timeout.input`
- `targetBadge.checkbox`
- `macro.selected.target`
- `colors.page.bg`
- `colors.macro.icon`
- `colors.reset.page`
- `colors.reset.all`
- ...

Every ID must map to at least one Playwright test case.

## Risks and Issues to Raise Now
1. Dual PI files (`property-inspector.html` and `property-inspector-v2.html`): confirm only v2 is in scope for full coverage.
2. Current inline-script PI complexity: keep tests against live HTML first; defer refactor until safety net exists.
3. Sandboxed local runs may block socket binds; CI runners must allow localhost websocket server.
4. Existing test flakiness in unrelated bridge approval-workflow suite should be isolated from PI gate.
5. Need explicit decision on what counts as “UI reaction” for non-visual settings (PI status only vs deck icon rerender evidence).

## Definition of Done
Done means all are true:
- Playwright closed-loop PI tests exist and pass in CI
- Every PI control has mapped automated test coverage
- Tests validate request->ack/error->snapshot cycle, not snapshot-only inference
- Tests validate downstream render reaction for controls expected to affect key visuals
- Manual ad-hoc clicking is no longer required to validate PI fixes

## Proposed Delivery Sequence
1. Land harness + smoke
2. Land global + selected macro controls
3. Land color + reset + scope/reorder controls
4. Land render-reaction tests
5. Land CI gating + coverage manifest enforcement

---

This document is a planning-only update. No implementation is included here.
