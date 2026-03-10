# TODO 6 - Reviewed With Issues, Comments, and Recommendations

## 0) Follow-up scope from TODO 5
Original ask:
- fully relocate per-slot controls into the selected-slot panel
- add regression test to enforce scope placement

Issue:
- Current PI sections are labeled by scope, but control placement is still mixed in places.

Comment:
- This creates a trust gap: users cannot infer whether a control affects one slot or all slots by location alone.

Recommendation:
- Treat this as a structural PI pass (not just copy updates).
- Move all selected-slot controls into one panel and all global controls into another.
- Add one PI DOM-level test that fails if selected-slot controls are rendered in global section.

---

## 1) PI Layout and Organization

### 1.1 Target App and Target Badge classification
Issue:
- `Target app` and `Target badge` appear in a global-labeled area, but they are not both global.

Comment:
- Current behavior is mixed:
  - `Target app` is per-slot.
  - `Target badge` is global.
- This mixed placement makes the scope unclear.

Recommendation:
- Keep model as:
  - per-slot `targetApp`
  - global `showTargetBadge`
- Move per-slot `Target app` to Selected Slot panel.
- Keep `Target badge` in Global panel.
- Add explicit scope chip to each row: `Global` or `Selected slot`.

### 1.2 Move debug elements below Apply; compress connection status
Issue:
- PI is too tall and diagnostics occupy high-value space.

Comment:
- Users need edit controls first; diagnostics second.

Recommendation:
- Move diagnostics below Apply / macro editing area.
- Replace top status banner with compact line:
  - `●` green/red + `PI build ...`
- Keep diagnostics collapsible and collapsed by default.

### 1.3 Rename "Text to send" to "Prompt to send"
Issue:
- Current label is less intuitive for users writing prompts.

Comment:
- "Prompt" better matches expected usage.

Recommendation:
- Rename UI label to `Prompt to send`.
- Keep payload/storage key as `text` to avoid migration churn.

### 1.4 Title field usability and typography conflict
Issue:
- Stream Deck title strip and in-icon label can conflict visually.

Comment:
- User expectation should be set clearly in PI.

Recommendation:
- Add plain-language PI hint near Label field:
  - "Decky draws this label inside the icon. Stream Deck title text is not used."
- Keep title-clearing hardening as deferred work (explicitly deferred).

### 1.5 Add Macro button and multi-target question (plain language)
Issue:
- "Add Macro" behavior is unclear, and users are asking if one button can send to two AI apps.

Plain-language explanation:
- What `Add Macro` does:
  - It creates one more macro entry in Decky config.
  - It gives you another configurable button definition in the PI list.
- What it does NOT do:
  - It does not drag/place a `Decky Slot` action on the physical Stream Deck for you.
  - It does not "nest" one Decky Slot inside another.
  - It does not duplicate an existing hardware key binding.
- What it is for:
  - Defining additional button content (label/prompt/icon/target/colors) in config.
- Capabilities today:
  - One macro entry sends to one target app per press.
- Limitation today:
  - One button cannot fan out to two target apps in a single press.

Recommendation:
- Keep this behavior and document it directly in PI help text.
- Add explicit note: "One button press -> one target app."
- Multi-target fanout should be a separate future feature (not hidden behind Add Macro).
COMMENT: I do not understand your explanation.  Defer this item.
---

# Phased Implementation Plan

## Phase 1 - PI Scope Correctness (High Priority)
Goals:
- remove scope ambiguity for target controls
- enforce placement with regression tests

Tasks:
- Relocate `Target app` row into Selected Slot panel.
- Keep `Target badge` in Global panel.
- Add per-row scope chips.
- Add PI test that asserts control placement by section.

Acceptance criteria:
- Scope is visually obvious.
- Tests fail if scope placement regresses.

## Phase 2 - PI Vertical Compression + Diagnostics (High Priority)
Goals:
- reduce PI height pressure
- keep core editing controls above diagnostics

Tasks:
- Replace top banner with compact status dot + PI build line.
- Move diagnostics to bottom.
- Make diagnostics collapsed by default.

Acceptance criteria:
- Core controls are above fold in typical PI height.
- Diagnostics remain accessible but non-intrusive.

## Phase 3 - Copy and Usability Cleanup (Medium Priority)
Goals:
- remove ambiguous wording
- explain Add Macro and Label behavior in simple terms

Tasks:
- Rename `Text to send` to `Prompt to send`.
- Add Label/title clarification hint.
- Add Add Macro help text with capability/limitation statement.

Acceptance criteria:
- New users can explain Add Macro correctly after reading PI help.

## Phase 4 - Behavioral Clarifications and Optional Extensions (Medium/Low)
Goals:
- resolve multi-target expectations explicitly

Tasks:
- Keep current rule: one macro -> one target app.
- Document this as an explicit non-goal for current tranche.
- (Optional future) draft `multiTargetMacro` spec separately.

Acceptance criteria:
- No ambiguity about fanout capability in docs/UI.

## Phase 5 - Validation + Docs Update (Required)
Goals:
- ensure UI changes are stable and documented

Tasks:
- Run plugin unit + PI tests.
- Add PI tests for scope placement and compact status row.
- Update README PI section to match final panel structure.

Acceptance criteria:
- CI passes.
- README and PI behavior align.
