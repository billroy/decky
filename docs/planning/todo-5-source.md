# Todo 5 - Reviewed With Issues, Comments, and Implementation Proposals

## 1) Restore 13-button config if possible
Issue: Current config state may have been overwritten, and recovery sources are unclear.
Comment: The highest-probability sources are prior git commits, local backup files, or logs/snapshots produced during test runs.
REVIEW COMMENT: No, it has always been rogue tests written by you.  Happened 6 times so far.
Implementation proposal:
- Add a recovery script at `scripts/recover-config.mjs` that scans candidate files and emits ranked restore candidates.
- Add a dry-run diff mode against current `~/.decky/config.json`.
- Restore only with explicit confirmation (no automatic overwrite).

## 2) Is there a default config, and where?
Issue: User-facing docs do not clearly state default config source and runtime path.
Comment: Code currently defines defaults in `bridge/src/config.ts` (`DEFAULT_CONFIG`) and writes runtime config to `~/.decky/config.json` (or `DECKY_HOME/config.json`).
Implementation proposal:
- Document this in README under a short "Config lifecycle" section.
- Add a PI "Open config location" helper action (optional) for diagnostics.
REVIEW COMMENT: Could the default be a file in the repo instead of embedded in the code, for easier editing?  Consider.

## 3) Layout brittleness when inserting/deleting macros
Issue: Current model is index-based; deleting/inserting shifts downstream mappings.
Comment: This is correct for compact arrays but fragile for long-lived button placement.
Implementation proposal:
- Introduce stable `slotId` semantics separate from list order.
- Persist sparse slot map keyed by physical slot index (`slots[slotIndex] -> macroRef`) and keep macro definitions separate.
- Migration: load legacy `macros[]` into sparse map preserving existing rank-to-slot behavior initially.
REVIEW COMMENT: Be sure to handle different SteamDeck button layout dimensions

## 4) Drag/drop in preview with swap semantics
Issue: Existing editing is list-centric and not visually coupled to deck geometry.
Comment: Swap semantics are better than replace semantics for predictable user intent.
Implementation proposal:
- Add a 3x5 preview grid in PI with drag and swap behavior.
- Keep list editor as advanced mode; grid becomes primary assignment UI.
- Constraints to evaluate: Stream Deck PI viewport space and event wiring complexity.
REVIEW COMMENT: Thanks for proposal, hold for now.

## 5) Why two PI files?
Issue: `property-inspector.html` and `property-inspector-v2.html` are duplicate maintenance risk.
Comment: Manifest currently points at `ui/property-inspector-v2.html`.
Implementation proposal:
- Keep one canonical PI source (`property-inspector-v2.html`).
- Either remove old file or generate compatibility alias at build time.
- Add CI check that fails if duplicate PI files diverge.

## 6) Move todo files and commit untracked planning/scripts files
Issue: Bulk committing untracked files can accidentally include logs/test artifacts.
Comment: Current untracked set appears mixed (docs + scripts + generated/test dirs).
Implementation proposal:
- Move `todo-4.md` and `todo-5.md` to `docs/planning/`.
- Commit only allowlisted paths: `docs/planning/**`, `scripts/**`.
- Add/expand `.gitignore` for `plugin/test-results/`, `plugin/.oracle/`, runtime logs.
- REVIEW COMMENT: Do not include logs/test artifacts. 

## 7) Config backup/rotation
Issue: `config.json` is a single point of failure.
Comment: Save path currently overwrites in place without retained history.
Implementation proposal:
- Before each successful save, rotate `config.json.bak.1..10` (newest is `.bak.1`, prune `.bak.10`).
- REVIEW COMMENT: make it 0..9
- Write config atomically using temp file + rename.
- Add `POST /config/restore` endpoint with explicit backup index selection.
- Add PI diagnostics pane showing latest backup timestamps.  REVIEW COMMENT: PI pane is way too long vertically.  defer this point.

## 8) PI clarity: global vs per-button settings
Issue: Global and per-button controls are interspersed, causing mental model confusion.
Comment: Current section names are ambiguous and do not reinforce scope boundaries.
Implementation proposal:
- Reorganize PI into two top-level panels:
  - Global page settings
  - Selected button settings
- Add explicit scope badges on controls (Global / Selected slot).
- Collapse advanced diagnostics and test controls into a separate "Diagnostics" accordion.

## 9) PI panel naming improvements
Issue: Current names are generic and overlap.
Comment: "Settings" and "Macro Buttons" are too broad.
Implementation proposal:
- Rename "Settings" to "Global Behavior".
- Move Theme controls into "Global Appearance" with page default colors.
- Rename "Macro Buttons" to "Selected Slot" (single-slot mode) and "All Slots" (list mode).

## 10) New themes: Candy Cane, Gradient Blue, Wormhole
Issue: Requested themes are not present and have non-trivial rendering rules.
Comment: Gradient Blue and Wormhole require deterministic per-slot gradient math.
Implementation proposal:
- Candy Cane: alternating red/white stripe palette with contrast-checked text/icon color.
- Gradient Blue: compute color from slot position (x,y) with top-left to bottom-right interpolation.
- Wormhole: radial monochrome map (lighter edges, darker center) using slot distance from center.
- Add unit tests that verify deterministic output by seed and slot index.

## 11) Review Command dropdown options and test survivors
Issue: Dropdown currently includes command, utility actions, and widget types; stale options are possible.
Comment: Current options include `macro`, `widget`, `approve`, `deny`, `cancel`, `restart`, `openConfig`, `approveOnceInClaude`, `startDictationForClaude`.
Implementation proposal:
- Audit real usage + maintenance cost; demote niche actions into optional "Presets" if needed.
- Keep only actively supported actions in primary dropdown.
- Add PI test matrix for each action type:
  - selection renders expected controls
  - save/round-trip persists
  - key press dispatches expected bridge action

## 12) README overhaul (do last)
Issue: README is out of sync with PI-first workflow.
Comment: Installation and usage docs should emphasize drag-to-slot initialization and PI behavior.
Implementation proposal:
- Reframe README around PI workflow first; keep config.json as advanced appendix.
- Expand install section for moderately technical users, including rebuild/restart sequence.
- Add screenshot set for: default PI, global settings, selected slot editing, theme apply modal.
- If screenshots cannot be committed, document exact reason and provide textual walkthrough.

---

# Staged Implementation Plan

Phase 1 (safety + hygiene)
- Implement config backup rotation + atomic writes.
- Add restore tooling endpoint/script.
- Clean untracked file policy (`.gitignore`, allowlist commit paths).

Phase 2 (PI clarity + naming)
- Re-panelize global vs selected-slot controls.
- Rename sections and add scope markers.
- Keep diagnostics in dedicated collapsible area.

Phase 3 (slot model hardening)
- Introduce stable slot mapping model.
- Add swap-based drag/drop grid editor.
- Add migration path from compact macro array.

Phase 4 (themes + action audit)
- Add Candy Cane, Gradient Blue, Wormhole.
- Audit command dropdown options and trim/stage deprecated entries.
- Expand automated PI + render tests for each surviving option.

Phase 5 (docs + release)
- Overhaul README to PI-first narrative.
- Document config lifecycle and recovery.
- Add screenshots and manual test checklist.

Delivery notes
- Work in a dedicated worktree branch.
- Commit by phase to keep reviewable PR scope.
- Open PR at end of phase bundle or one PR per phase if risk is high.
