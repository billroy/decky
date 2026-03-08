## Status
Updated 2026-03-08.

## Feature enhancement: periodically updating information widgets
### Feasibility summary
- A periodically updating widget is feasible in Decky.
- A usage widget is feasible only when the provider exposes usage via API/CLI/session logs that we can read reliably.
- Claude/Codex desktop apps do not currently expose a stable local "current session + current week usage %" endpoint to this plugin directly.

### Recommendation
- Add a new button type `widget` with two refresh modes:
- `onClick` (manual refresh)
- `intervalMinutes` (1..60)
- For rendering, use a compact two-line layout: `S:xx%` and `W:yy%`.
- Color thresholds:
- green `<80%`
- amber `>=80% and <90%`
- red `>=90%`

### Provider metric proposal (v1)
- Claude: usage only if we can source it from a documented API endpoint or CLI output.
- Codex/ChatGPT/Cursor/Windsurf: same constraint; avoid scraping UI.
- If no usage source exists, show a fallback widget:
- Bridge health (`connected`, `disconnected`)
- Last hook event age (`last update: 2m`)
- Current state (`idle`, `awaiting-approval`, etc.)

### Proposed staged plan
1. Implement generic widget framework (`widget` macro type, timer scheduler, on-click refresh).
2. Ship "Bridge Status" widget first (no external dependency).
3. Add provider usage adapters only where data source is stable and documented.

## Way to click Approve Once / press Return
### Recommendation
- Add a dedicated action `approveOnceInClaude`.
- Behavior:
- Activate Claude app.
- Send Return key once.
- Guardrails:
- Only run when bridge state is `awaiting-approval`.
- Config flag to enable/disable this action.
- If Claude is not running/focused in time, show a temporary error state on key.

## Slash commands
### Investigation result
- Slash commands generally work if they are inserted as plain text into Claude's input and submitted.
- Reliability depends on current cursor/focus in the Claude input box.

### Recommendation
- Support slash commands as normal macros with text starting `/`.
- Add optional per-macro `submit` flag (`true` default); when false, paste only.

## Talk to Claude (speech input)
### Recommendation
- Add action `startDictationForClaude`.
- Behavior:
- Activate Claude app.
- Trigger macOS Dictation hotkey (user-configured at OS level; do not hardcode fragile key combos).
- Document prerequisite: Dictation must be enabled in macOS Settings.

## Remove edit feature
### Completed
- Removed editor selector from Property Inspector.
- Removed empty-slot "open config file" behavior.
- Unconfigured buttons are now no-op.

### Decision
- Do not auto-open README from empty slots in v1; it is noisy and easy to trigger by mistake.

## README update
### Completed
- README now documents Property Inspector-driven configuration.
- README documents no-op behavior for unconfigured buttons.

### Screenshot status
- No stable screenshots were added in this pass.
- Add screenshots after next UI-stable checkpoint.


