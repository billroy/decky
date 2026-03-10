Review notes below are based on current implementation in `plugin/src/layouts.ts`,
`plugin/com.decky.controller.sdPlugin/ui/property-inspector-v2.html`,
`bridge/src/app.ts`, `bridge/src/codex-monitor.ts`, and `bridge/src/macro-exec.ts`.

- Github is reporting Plugin PI Test failures every push. Investigate.
  - Triage result (2026-03-09):
    - `npm test` in `plugin` passed (79/79).
    - `npm run test:pi` in `plugin` passed (38/38).
    - `npm run test:pi:coverage-map` passed.
    - `npm run check:pi-sync` failed: PI files out of sync.
  - Root cause [P1]: [`property-inspector-v2.html`](plugin/com.decky.controller.sdPlugin/ui/property-inspector-v2.html) was updated without syncing [`property-inspector.html`](plugin/com.decky.controller.sdPlugin/ui/property-inspector.html). This causes CI failure in workflow `.github/workflows/plugin-pi-tests.yml` at `check:pi-sync`.
  - First bad commit identified locally: `c4aacc4` ("Add Codex target support for approval utility buttons"), which touched v2 but not legacy PI HTML.
  - Why this shipped for many commits:
    - The failing check existed but was not an effective merge gate on `main` (branch protection did not block integration on red).
    - Process gap: no pre-push/pre-merge sync guard in local workflow.
  - Recommendation:
    - Immediate: sync the two PI files and re-run `check:pi-sync`.
    - Hardening: deferred by request. Enforce manually via feedback on failed CI until policy changes.

Selected Slot UI control revisions and font control addition

- Add a font size selector to control the Label field's rendered size. Initialize it with the current layout-selected font size or a default. Ensure older configs are ok.
  - Comment: Label font size is currently hard-coded in `macroSVG` (`26`/`32` based on length), not persisted per macro.
  - Issue [P1]: No `fontSize` field exists in `MacroDef`/`MacroInput` or config validation, so persistence and migration are missing.
  - Recommendation: Add optional `fontSize` to config schema + PI payload + render path; default to legacy behavior when missing.

- Rearrange the Selected Slot settings to this order:
  - Label and Font size
  - Type and icon and submit checkbox
  - Prompt
  - Provider dropdown
  - Colors and reset button
  - Remove the tiny disclaimer text under label.
  - Comment: Current order is `Label + Type`, then `Icon`, then `Target app`, then `Submit`, then prompt/action panel.
  - Issue [P2]: The helper line under label is currently rendered and is visually small; user feedback is valid.
  - Recommendation: Reorder the PI template to match requested sequence and remove helper copy.

Icon design reconciliation

- There are two sets of icons that are jarringly different (legacy unicode + newer SVG/Lucide).
  - Comment: Confirmed. Current icon system mixes large unicode glyphs and stroke SVG icons with different visual weight.
  - Issue [P2]: Inconsistent style and scale between icon families.

- Add 10 new SVG icon types including replacements for old ones. Ensure old configs upgrade gracefully to new names.
  - Comment: Reasonable, but requires alias migration to avoid breaking saved configs.
  - Issue [P1]: No icon alias map/migration exists today; old config names are passed through directly.
  - Recommendation: Add icon alias map in config normalization and PI options.

- Include a stop-sign icon; suggest the rest.
  - Comment: Good addition; we should avoid name collisions with existing `stop`.
  - Recommendation: Candidate additions: `shield-off`, `octagon-x` (stop-sign), `ban`, `hand`, `clock-3`, `timer-reset`, `message-square-warning`, `file-warning`, `slash`, `bell-off`.

- The "circle/stop icon" - remove stop.
  - Comment: Current icon list includes `circle-stop` plus legacy `stop`.
  - Issue [P3]: Removing without migration breaks existing configs.
  - Recommendation: Keep `circle-stop` as alias for one release, hide from picker, auto-migrate to replacement.

- Remove the "--" before names in dropdown. Can they be replaced with tiny SVG badges?
  - Comment: Prefixes are currently unicode line markers in option labels.
  - Issue [P2]: Native `<select><option>` does not reliably support inline SVG rendering across environments.
  - Recommendation: Remove prefixes now; if visual previews are required, replace native select with custom listbox component.

- The SVG icons look small and have unused bottom space. Can they be based lower and made a few px bigger?
  - Comment: Current Lucide transform is `translate(36, 10) scale(3)` with label baseline at `y=122`.
  - Issue [P2]: Layout leaves visible dead space and weak icon prominence.
  - Recommendation: Increase icon scale and move icon group downward while keeping label collision checks.

- After some approval operations the Deck briefly shows two buttons: one with three blue dots, and one red with white square. Explain this state. It then sometimes transitions to one green refresh-like icon. Explain this too.
  - Comment: This is expected from current state layouts:
  - `thinking`: slot 0 is blue dots, slot 1 is red stop square.
  - `stopped`: slot 0 is green restart arrow.
  - Issue [P2]: State meaning is not discoverable in UI; users interpret as inconsistent behavior.
  - Concrete proposal:
    - Add a fixed "State Legend" block in PI directly under the compact connection/status row (`.pi-meta`) and above "Global Settings".
    - Legend copy:
      - `••• Thinking`: Codex is running and no approval action is currently available on this key.
      - `■ Stop`: Sends cancel/stop action for the active run.
      - `↻ Restart`: Returns Deck state from `stopped` to `idle`.
    - Keep it always visible (not in diagnostics) so users see it without expanding any section.

- Approvals to Codex sometimes do not work, or work in Codex but Deck UI does not return to idle.
  - Comment: Plausible. In mirror flow, approve path depends on Codex monitor events to settle state.
  - Issue [P1]: If monitor events are missed/out of order, UI can remain stuck in `awaiting-approval`.
  - Recommendation: Add approve-settlement timeout + fallback reconciliation path (status poll / stale-state watchdog).

- Whatever icon with three blue animated dots is, consider having it return Deck to Idle when pressed.
  - Comment: The dots key currently has no action (`THINKING` slot 0 only renders).
  - Issue [P2]: Forcing idle from this state can desync from host app if tool is still running.
  - Recommendation: Gate behind explicit "force reset" action with confirmation semantics (double tap / long press).
  - Decision: Hold. Do not implement in this phase.

Multiple approval request handling

- Explain what happens if multiple Approve buttons are configured for different providers and multiple requests arrive simultaneously.
  - Comment: Current architecture is single-request oriented (single state + single `approvalPending` boolean + single pending target/flow).
  - Issue [P0]: Concurrent approval requests are not queued; later events can be collapsed or overwrite context.

- Propose best handling with arbitrary queued requests and UI.
  - Comment: Needs explicit queue model with request IDs and provider metadata.
  - Recommendation: Introduce approval queue in bridge, persist latest N requests, and expose active+queue summaries to plugin.

- Ensure multi-approval handling uses only 4 buttons per approval for smaller decks.
  - Comment: Current approval layout already uses 4 cells (`approve/deny/cancel/tool-info`), so queue paging can fit.
  - Recommendation: Keep one "approval card" per 4-key row/page with `Prev`, `Info`, `Approve`, `Deny/Cancel` variants.

- Provider identification idea: first button is tool-approval no-op explainer with provider-matched background color.
  - Comment: Valid. Current target badges use a different internal color map and are shown only when enabled.
  - Issue [P2]: Provider color mapping is inconsistent with requested palette.
  - Recommendation: Adopt requested palette for approval states and keep contrast checks.

[
  { "app": "Claude",   "hex": "#C1502A", "name": "Warm coral",      "wcag_vs_white": "4.6:1 AA"  },
  { "app": "Codex",    "hex": "#5B6FD6", "name": "Periwinkle blue", "wcag_vs_white": "4.7:1 AA"  },
  { "app": "ChatGPT",  "hex": "#000000", "name": "Black",           "wcag_vs_white": "21:1 AAA"  },
  { "app": "Cursor",   "hex": "#3B2F8F", "name": "Indigo",          "wcag_vs_white": "9.2:1 AAA" },
  { "app": "Windsurf", "hex": "#0C6E6E", "name": "Deep teal",       "wcag_vs_white": "5.9:1 AA"  }
]

- Make a proposal to extend the Approve tool call lifecycle controls to cover all providers.
  - Comment: Current approval execution helpers only support `claude | codex` for approve/dismiss automation.
  - Issue [P1]: Type system and runtime behavior do not yet support provider-wide lifecycle control.
  - Recommendation: Generalize approval target type to all providers, then implement provider-specific strategy table.
  - Decision: Hold. Defer provider-wide lifecycle extension until after queue architecture lands and stabilizes.

Implementation plan

1. Repro + triage PI test failures
   - Capture failing CI jobs, reproduce locally, tag failure classes (flake, regression, env).
   - Add immediate guard tests for the identified regressions.
2. Add label font-size support end-to-end
   - Extend `MacroDef`/`MacroInput` schema with optional `fontSize`.
   - Validate/clamp in bridge config layer.
   - Send/receive via PI `configSnapshot` and `updateConfig`.
   - Render in `macroSVG` with backward-compatible defaults.
3. Refactor Selected Slot editor ordering
   - Rebuild macro editor block order to requested sequence.
   - Remove tiny label disclaimer.
   - Keep widget/action-specific controls behind type gating.
4. Icon system cleanup and migration
   - Define unified SVG icon catalog (+10 icons).
   - Add icon alias migration map for legacy names.
   - Remove picker prefix glyphs; keep plain text names.
   - Tune icon placement/scale and add visual regression tests for key states.
5. Clarify and harden approval state UX
   - Add explicit PI "State Legend" block below `.pi-meta` with exact copy:
     - `••• Thinking`: Codex is running; key is informational only.
     - `■ Stop`: Sends cancel/stop action.
     - `↻ Restart`: Returns Deck from `stopped` to `idle`.
   - Add mirror approve settlement timeout/reconciliation fallback.
   - Note: "force reset from thinking" is explicitly out of scope for this phase (held).
6. Multi-approval queue architecture
   - Add queue model in bridge with request ID, provider, tool label, createdAt, and state.
   - Emit queue updates over socket.
   - Render 4-key queue-aware approval layout (info + actions + navigation).
7. Validation and rollout
   - Run unit + PI tests; add migration tests for legacy configs.
   - Ship behind feature flag for queue rewrite, then remove flag after soak.

Deferred (hold)

1. Thinking-key forced idle action.
2. Provider-wide approve/dismiss lifecycle controls for ChatGPT/Cursor/Windsurf.
