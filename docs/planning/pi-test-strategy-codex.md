# PI Test Strategy

## Objective
Build a closed-loop, automated test system for all Property Inspector (PI) controls so regressions are detected before merge, without requiring manual Stream Deck app clicking.

## Problem Statement
Current PI failures are hard to debug because validation is split across:
- PI HTML/JS state logic
- plugin action relay logic
- bridge config validation/persistence
- Stream Deck runtime messaging

When one leg fails, PI can show stale UI or timeout errors without deterministic root-cause signals.

## -codexstrategy
Use a layered strategy with an explicit acknowledgement protocol and contract tests at each boundary:
1. PI UI logic tests (DOM-level)
2. PI <-> plugin protocol tests (message contract)
3. Plugin <-> bridge integration tests (config persistence + re-render)
4. Optional desktop smoke tests in real Stream Deck app (nightly/manual gate)

Do not rely on only one layer. A fix is "done" only when all required layers pass.

## Architecture Changes Required (Minimal, High Impact)
### 1) Add explicit config result events
Current PI infers success from `configSnapshot`. Add explicit result messages:
- `updateConfigAck` with payload hash + revision
- `updateConfigError` with structured error code/message

Benefits:
- deterministic pass/fail in tests
- no ambiguous timeout-only failure mode
- easier user-facing diagnostics

### 2) Add config revision and payload hash
On bridge save:
- increment `configRevision`
- echo back `payloadHash` in ack

PI uses this to confirm the exact update was applied.

### 3) Extract PI runtime logic from inline HTML
Move inline `<script>` PI logic into testable module(s), e.g.:
- `plugin/src/pi/state.ts`
- `plugin/src/pi/controller.ts`

Keep HTML as thin wiring. This enables true unit tests instead of brittle DOM-only tests.

## Test Technology Stack
### Core
- `Vitest` for unit/integration tests
- `Playwright` for headless PI DOM tests
- `jsdom` only for fast pure logic tests (not websocket behavior)

### Protocol/Contract
- `zod` or `ajv` schemas for all PI/plugin/bridge messages
- contract test fixtures for:
  - `configSnapshot`
  - `updateConfig`
  - `updateConfigAck`
  - `updateConfigError`

### Optional Desktop E2E
- macOS UI automation (AppleScript or Swift AX) for a small smoke suite:
  - open PI
  - change target app
  - click Apply
  - verify icon badge change

Run this only in dedicated environment due flakiness risk.

## Closed-Loop PI Harness Design
Create a dedicated test harness that simulates Stream Deck websocket and plugin callbacks:
- fake `connectElgatoStreamDeckSocket(...)`
- fake `sendToPlugin(...)`
- deterministic mock plugin responder

Test flow:
1. Load PI HTML in Playwright
2. Inject harness websocket bridge
3. Send initial `configSnapshot`
4. Perform UI interactions
5. Assert outbound `updateConfig`
6. Return either `updateConfigAck` or `updateConfigError`
7. Assert PI state transitions (`Apply` enabled/disabled, status text, field values)

This gives full closed-loop behavior without launching Stream Deck app.

## PI Coverage Matrix (Must Automate)
### Global controls
- Theme selector + Apply Theme strategy panel
- Approval timeout
- Target badge checkbox
- Save/Apply button enabled/disabled rules

### Selected macro controls
- Selected target app dropdown
- Label/text/icon edits
- Per-macro colors
- Reset this macro colors

### Page defaults
- Bg/Text/Icon default swatches
- Reset page defaults
- Reset all overrides

### Macro list behavior
- Add/remove macro
- Reorder in "Show all"
- Selected vs show-all scope consistency
- Unconfigured slot no-op behavior

### Error paths
- Bridge validation error returned
- Ack timeout returned
- Recover after error with successful retry

## Required Assertions for Every PI Save Test
Each save-path test must assert all of:
1. outbound payload content
2. bridge acceptance/rejection outcome
3. PI status message correctness
4. Apply button final state
5. post-save snapshot values reflected in controls

## Suggested CI Pipeline
### PR required
- `plugin`: unit + PI harness tests
- `bridge`: config validation tests
- contract schema tests

### Nightly optional
- desktop smoke tests with real Stream Deck app

## Implementation Plan
### Phase 1 (1-2 days)
- Add `updateConfigAck/updateConfigError`
- Add payload hash + revision
- Add bridge unit tests for ack/error emission

### Phase 2 (2-3 days)
- Extract PI script logic to modules
- Build Playwright PI harness
- Cover save-path, target dropdown, and color reset flows

### Phase 3 (2-3 days)
- Complete full PI coverage matrix
- Add regression tests for known bugs (target app not persisting, false apply success, stale selection index)

### Phase 4 (optional)
- Add desktop smoke automation

## Definition of Done
PI bugfix is mergeable only if:
- all PI harness tests pass
- bridge config tests pass
- at least one end-to-end save-path test proves target-app change persists and badge updates after ack

## Immediate Next Steps
1. Implement explicit `updateConfigAck/updateConfigError`.
2. Add first Playwright closed-loop test:
   - select Yes macro
   - change target app
   - click Apply
   - assert ack and persisted `targetApp`.
3. Add regression test for `colors: {}` + target update in same payload.
