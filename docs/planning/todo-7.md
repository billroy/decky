# TODO 7 - Cross-Platform Portability Execution Checklist

Derived from the reviewed plan in `docs/planning/ports.md`.

## Objective

Deliver reliable Windows/Linux support in staged form:
- Phase target for first ship: **through Phase 2** (core workflow, no non-mac text injection).
- Phase 3 text delivery remains optional and gated.

## Issue-Driven Work Items

### Issue 1: Platform feasibility is assumed, not proven

- [ ] Run host smoke test on Windows for:
  - plugin load in Stream Deck host
  - PI websocket handshake
  - bridge connect/status
- [ ] Run host smoke test on Linux for same checks.
- [ ] Record evidence and go/no-go notes in `docs/planning/ports.md`.

Acceptance:
- [ ] Documented pass/fail per host platform.
- [ ] Any blockers are explicitly linked to follow-up tasks.

### Issue 2: Hooks are shell-bound and cross-platform fragile

- [ ] Add Node hook runtime entrypoints for `PreToolUse`, `PostToolUse`, `Notification`, `Stop`.
- [ ] Preserve behavior parity:
  - nonce handling
  - auth token header behavior
  - timeout semantics
  - fail-closed approval logic
- [ ] Keep shell wrappers (macOS/Linux) only as optional compatibility shims.
- [ ] Add hook contract tests that run on macOS/Linux/Windows in CI.

Acceptance:
- [ ] No required execution path depends on `stat -f`, `/dev/urandom`, or shell-only tools.
- [ ] Existing approval workflow tests still pass.
- [ ] New hook parity tests pass on all 3 OS targets.

### Issue 3: Claude settings path policy is inconsistent

- [ ] Decide and document one canonical settings path policy.
- [ ] Align:
  - `hooks/install.sh`
  - root installer
  - README/planning docs
- [ ] Add installer sanity check to detect and report conflicting local/global settings.

Acceptance:
- [ ] All docs/scripts reference one policy.
- [ ] Installer output clearly states what file was updated.

### Issue 4: Unsupported actions are not capability-gated

- [ ] Add bridge capability snapshot fields:
  - `supportsTextDelivery`
  - `supportsDictation`
  - `supportedTargets`
  - optional `platform`/`windowSystem`
- [ ] Include capabilities in PI snapshot payload.
- [ ] Update PI UX:
  - disable or hide unsupported controls/actions
  - show clear reason text (no silent no-op)
- [ ] Update plugin action behavior to return structured unsupported errors.

Acceptance:
- [ ] On unsupported hosts, PI prevents invalid action configuration.
- [ ] Runtime errors are explicit and actionable.
- [ ] PI tests cover capability-gated behavior.

### Issue 5: Security model on Windows is undefined

- [ ] Write platform-specific approval-gate integrity requirements.
- [ ] Implement best-effort integrity checks per OS.
- [ ] Add tests for nonce/integrity failure paths.

Acceptance:
- [ ] Threat model section added to docs.
- [ ] Gate behavior is deterministic and tested for integrity failures.

### Issue 6: Installer and build workflow are macOS-oriented

- [ ] Add Node-based cross-platform installer entrypoint.
- [ ] Ensure installer handles:
  - dependency install
  - plugin build
  - hook registration
  - platform-specific instructions for linking/restart
- [ ] Keep legacy shell installer as optional wrapper.

Acceptance:
- [ ] Installer executes on Windows/Linux/macOS.
- [ ] Clear platform-specific instructions when auto-link cannot run.

### Issue 7: Optional cross-platform text delivery (Phase 3)

- [ ] Define explicit product go/no-go gate before starting.
- [ ] Introduce `TextDelivery` interface in `bridge/src/macro-exec.ts`.
- [ ] Keep macOS backend as baseline implementation.
- [ ] Add Windows backend prototype.
- [ ] Add Linux backend prototype (X11-first scope).
- [ ] Return structured unsupported responses on unsupported environments (Wayland-only, etc.).

Acceptance:
- [ ] Backend selection by platform is deterministic.
- [ ] Fallback behavior is explicit; no silent failure.
- [ ] Integration tests validate each implemented backend path.

## Phased Execution Board

## Phase 0 - Feasibility and decisions

- [ ] Issue 1 complete
- [ ] Issue 3 decision made
- [ ] Issue 5 baseline security decision made
- [ ] Issue 7 go/no-go criteria defined

Exit gate:
- [ ] Written approval to proceed to Phase 1/2 implementation.

## Phase 1 - Hook runtime unification

- [ ] Issue 2 complete
- [ ] Issue 3 alignment complete
- [ ] CI job executes hook contract tests on all target OSes

Exit gate:
- [ ] Hook parity validated across platforms.

## Phase 2 - Core portability (no non-mac injection)

- [ ] Manifest platform expansion done
- [ ] Issue 4 capability negotiation and PI gating done
- [ ] Issue 6 installer portability done
- [ ] Core workflow validated on each platform (status + approve/deny/cancel)

Exit gate (first release target):
- [ ] Core feature set works on macOS/Linux/Windows with clear unsupported-action UX.

## Phase 3 - Optional text delivery

- [ ] Issue 7 implementation and tests complete

Exit gate:
- [ ] Reliability acceptable and limitations documented.

## Phase 4 - Hardening and release

- [ ] CI matrix green for bridge + PI + installer smoke tests
- [ ] Security regression suite green
- [ ] Platform docs published

Exit gate:
- [ ] Release checklist complete.

## Tracking Notes

- Keep this checklist as execution source of truth.
- Any scope change should update both this file and `docs/planning/ports.md` decision records.
