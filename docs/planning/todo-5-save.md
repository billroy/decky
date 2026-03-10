# TODO 5 — Likely Missed or Partially Missed Items

## 1) Provider usage adapters for widgets are not implemented yet
- `todo-3` staged plan item 3 (provider usage adapters) is still open.
- Current widget support is limited to `bridge-status` only.
- Evidence:
  - `bridge/src/config.ts` defines `WidgetKind = "bridge-status"` only.
  - `plugin/src/layouts.ts` renders only `bridge-status` widget type.

## 2) Approve-once failure UX is partial
- Guardrails exist (state + config enable/disable), but there is no temporary per-key error state shown when Claude activation/keypress fails.
- Current behavior logs and/or emits errors, but does not render an explicit transient failure state on key.
- Evidence:
  - `bridge/src/app.ts`
  - `plugin/src/actions/approve-once.ts`

## 3) Dictation trigger implementation differs from original recommendation
- Recommendation was to trigger user-configured macOS dictation hotkey.
- Current implementation activates Claude and clicks `Edit -> Start Dictation…` via AppleScript menu automation.
- This may be less robust across app/menu localization and app changes.
- Evidence:
  - `bridge/src/macro-exec.ts` (`startDictationForClaude`)

## 4) Target badge default-provider logic has a latent edge case
- Badge suppression is currently hardcoded for `claude`, not "current configured default provider".
- If default provider is changed by config, badge behavior may diverge from intended "hide badge on default provider" semantics.
- Evidence:
  - `plugin/src/layouts.ts` in `targetBadge()` and `setTargetBadgeOptions()`.

## 5) PI build stamp consistency is not fully normalized
- `property-inspector-v2.html` and legacy `property-inspector.html` report different `PI_BUILD_ID` values.
- This is not a runtime blocker but can cause confusion during manual validation.
- Evidence:
  - `plugin/com.decky.controller.sdPlugin/ui/property-inspector-v2.html`
  - `plugin/com.decky.controller.sdPlugin/ui/property-inspector.html`

## Notes
- `todo-4.md` issues appear addressed.
- Root-level `todo-5.md` remains a short placeholder; this file captures the concrete residuals for follow-up planning.
