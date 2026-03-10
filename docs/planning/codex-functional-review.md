# Decky Functional Completeness Review

Date: 2026-03-07
Reviewer: Codex (static review + test baseline)
Scope: `bridge/`, `plugin/`, `hooks/`, install/start flows, tests, `spec.md`, `initial-analysis.md`, `todo.md`

## Executive assessment
Decky is functionally strong on the core loop (hook-driven state, approval actions, dynamic key layouts, macro injection), but incomplete on operational robustness, config UX depth, and broader feature vectors defined in planning docs.

Current completeness estimate against stated project intent: **~65%**
- Core control loop: high completeness
- Configuration/productization: medium completeness
- Advanced workflow features (profiles, observability, voice/usage, recovery): low completeness

## What is complete today
- Bridge receives Claude hook events and manages state transitions: `bridge/src/app.ts`, `bridge/src/state-machine.ts`.
- StreamDeck actions can approve/deny/cancel/restart and trigger macros: `plugin/src/actions/*.ts`.
- Dynamic layout switching by state is implemented: `plugin/src/layouts.ts`.
- Blocking `PreToolUse` hook approval flow exists with timeout behavior: `hooks/pre-tool-use.sh`.
- Config persistence (`~/.decky/config.json`) and bridge config endpoints are implemented: `bridge/src/config.ts`, `GET/PUT /config`.
- Property inspector supports editing macro label/text and saving to plugin/bridge: `plugin/com.decky.controller.sdPlugin/ui/property-inspector.html`.
- Installation/start scripts are present and usable: `install.sh`, `start.sh`.

## Functional gaps and enhancement vectors

### 1. State model fidelity and hook coverage gaps
Priority: High

Gaps:
- `SubagentStop` is supported server-side (`VALID_EVENTS`) but no dedicated hook script registration/install path exists in `install.sh` or `hooks/install.sh`.
- State model does not expose richer planned states from `initial-analysis.md` (for example `tool-complete`, subagent-running granularity), limiting UI expressiveness and diagnostics.

Enhancement vector:
- Add missing hook wiring and expand state taxonomy to support clearer layouts and analytics.

### 2. Timeout/config behavior is split across systems
Priority: High

Gaps:
- Hook timeout is controlled by env var `DECKY_TIMEOUT` in shell (`hooks/pre-tool-use.sh`), while `approvalTimeout` in config is managed independently by bridge (`bridge/src/config.ts`).
- Users can edit timeout in app config, but it does not directly drive hook runtime unless env is separately managed.

Enhancement vector:
- Create a single source of truth for approval timeout and pass it deterministically to hooks.

### 3. Config UX is partial and lossy
Priority: High

Gaps:
- Property inspector edits only `label` and `text`; `icon` is not preserved when saving from UI (`property-inspector.html` save payload strips `icon`).
- No theme selector despite explicit roadmap (`todo.md` B2/B2.1).
- No profile support, no per-state customization, no editor command setting, no validation hints.

Enhancement vector:
- Evolve config schema and PI UI into a full control plane (icon/theme/profile/advanced settings).

### 4. Macro/layout scalability mismatch
Priority: Medium

Gaps:
- Runtime now supports up to 36 idle macros (`plugin/src/layouts.ts:156`), but tests still assert 15 (`plugin/src/__tests__/layouts.test.ts`), indicating drift.
- Product docs still describe up to 6 configurable macros in README; user experience expectations can diverge by device type.

Enhancement vector:
- Make macro capacity explicitly device-aware and keep docs/tests synchronized.

### 5. Operational resiliency and observability are thin
Priority: Medium

Gaps:
- No bridge health/heartbeat SLA and no explicit degraded-mode UX besides simple connected/disconnected state.
- No event log persistence or diagnostic timeline (planned in `initial-analysis.md` but not implemented).
- Hook scripts are fire-and-forget for non-blocking events with no retry/backoff or durable queue.

Enhancement vector:
- Add lightweight event log + health telemetry to reduce “silent failure” scenarios.

### 6. Workflow breadth from roadmap is mostly unimplemented
Priority: Medium

Gaps relative to planning docs:
- No profile switching.
- No usage/token telemetry.
- No voice/push-to-talk path.
- No dedicated “new session” action.
- No configurable “open config in editor” empty-slot action.

Enhancement vector:
- Introduce an extensible action framework and phased feature bundles.

### 7. Test completeness and environment assumptions
Priority: High

Gaps:
- Test suite assumes writing to `~/.decky/*` and binding network interfaces; this fails in constrained environments.
- Coverage is good for state transitions and basic layouts, but weak for property inspector behavior, install script correctness, and end-to-end hook<->bridge<->plugin orchestration under failure modes.

Baseline run observations (this environment):
- Bridge tests partially blocked by sandbox (`EPERM` on bind and home-dir writes).
- Plugin tests show one real drift failure: macro cap expectation still at 15 while runtime is 36.

Enhancement vector:
- Refactor tests to use temp paths and explicit loopback binding, then add missing integration scenarios.

## Prioritized remediation plan

### Phase 0 (Immediate, 1-2 days): stabilize core completeness
1. Wire `SubagentStop` hook installation and registration end-to-end.
2. Unify approval timeout source of truth (`config.approvalTimeout`), including hook consumption path.
3. Fix config save lossiness by preserving `icon` in PI round-trip.
4. Align tests/docs with 36-macro behavior (or intentionally revert cap and document decision).

Success criteria:
- All core states are externally triggerable from installed hooks.
- Timeout changes in config are reflected in actual approval wait behavior.
- Saving config in UI no longer drops icon metadata.
- Layout tests pass with current macro-cap policy.

### Phase 1 (Near term, 3-5 days): improve user-facing completeness
1. Implement theme support (`light` default + `dark`) in config, bridge, layouts, and PI.
2. Add schema validation and bounds for config fields (macro count, lengths, timeout range, enum fields).
3. Add editor-command action for empty slots (configurable command, safe default).
4. Improve status action to include last hook time and degraded/healthy indicators.

Success criteria:
- Theme can be switched without manual file edits.
- Invalid configs are rejected with actionable errors.
- Empty-slot utility action works on target host.
- Users can identify stale hook pipelines quickly.

### Phase 2 (Strategic, 1-2 weeks): feature expansion vectors
1. Add profile system (multiple macro/layout sets + fast switch).
2. Add lightweight event log (JSONL or SQLite) and diagnostics view/export.
3. Add workflow actions: new session, quick restart bridge, optional plan-mode helpers.
4. Evaluate and prototype token/usage telemetry surface.

Success criteria:
- At least two named profiles can be switched live.
- Event history supports debugging missed approvals.
- Session management actions reduce manual app interaction.
- Telemetry prototype demonstrates reliable data source feasibility.

### Phase 3 (Optional advanced track)
1. Voice input push-to-talk pipeline (local transcription).
2. Device-adaptive layout packs for MK.2 vs Studio defaults.

Success criteria:
- Voice macro submission path is usable with bounded latency.
- Layout defaults optimize for detected hardware dimensions.

## Recommended sequencing rationale
- Phase 0 addresses functional correctness drift and config/behavior mismatches that directly affect trust.
- Phase 1 closes visible product gaps users will immediately notice.
- Phase 2 grows the product into the roadmap feature envelope with manageable risk.
- Phase 3 should be pursued only after stability and observability are solid.

## Residual risks if plan is not executed
- Users observe inconsistent behavior (configured timeout vs actual timeout).
- UI edits can silently discard config metadata.
- State/layout behavior can diverge across hooks and devices.
- Regression risk remains high due to environment-coupled tests and incomplete end-to-end coverage.
