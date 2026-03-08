# Command Dropdown Audit

## Current options in PI

- `macro` - standard text macro, dispatches `action=macro` with `{text,targetApp,submit}`
- `widget` - `bridge-status` widget with refresh behavior
- `approve` - bridge approval action
- `deny` - bridge denial action
- `cancel` - bridge cancel action
- `restart` - local state reset action
- `openConfig` - reserved utility action
- `approveOnceInClaude` - approves pending gate (if any) and activates Claude
- `startDictationForClaude` - activates Claude dictation flow

## Necessity assessment

- Keep in primary dropdown:
  - `macro`
  - `widget`
  - `approve`
  - `deny`
  - `cancel`
  - `restart`
  - `approveOnceInClaude`
  - `startDictationForClaude`
- Keep but treat as advanced/system utility:
  - `openConfig`

Rationale:
- These actions are currently implemented and exercised in layouts/plugin/bridge paths.
- Removing now risks breaking existing user configs.

## Survivor test plan

1. PI persistence tests
- For each type, select in PI and save.
- Verify config snapshot round-trip preserves `type` and required fields.

2. Render tests
- For each type, verify icon/title render is non-empty and deterministic for a fixed theme seed.

3. Dispatch tests
- Press simulated key per type and verify expected bridge action payload:
  - `macro` -> `sendAction("macro", data)`
  - `approve/deny/cancel/restart` -> expected action IDs
  - `approveOnceInClaude/startDictationForClaude` -> expected action IDs
  - `widget` -> `widget-refresh` behavior

4. Negative-path tests
- Disabled utility actions should still render safely and emit explicit errors where applicable.
- Unconfigured slots should remain no-op.
