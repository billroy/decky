# Decky Live Test Suite: MCP-Based Approach

> **Last updated:** 2026-03-12. Always-allow feature removed; tool count reduced from 25 to 22. Rules-related tools (`decky_list/add/delete_always_allow_rule`) no longer exist.

## What the MCP layer already enables

The 22 MCP tools give live read/write access to almost everything stateful:

| Capability | Coverage |
|---|---|
| Bridge health, state, uptime | Full |
| Config (macros, theme, colors) | Full CRUD |
| Approval queue inspection | Full |
| Debug trace + logs | Full (DECKY_DEBUG=1) |
| Deck layout (via slotHeartbeat) | Read-only |

This is a strong foundation. Config round-trips, color/theme changes, and state inspection can all be exercised live in a Claude session right now.

---

## Gap analysis

### Gap 1: No way to drive state transitions
The bridge's state machine transitions via `POST /hook` (PreToolUse, PostToolUse, Stop, etc.), but there is no MCP tool exposing that endpoint. Without this, state can only be observed — not injected — so approval flows, AskUserQuestion handling, cancellation, etc. cannot be tested end-to-end.

### Gap 2: No way to send approval actions
Approve/deny/cancel/macro actions go through Socket.io, not HTTP. No MCP tool exists for this. A full approval round-trip (inject PreToolUse → verify state → approve → verify idle) is not currently possible.

### Gap 3: Visual verification of the deck — solved

The Stream Deck desktop app's preview pane is pixel-synced (or near enough) with the physical hardware. A screenshot of the app window serves as a reliable proxy for what the device displays, without requiring a camera or external capture rig.

**Capture method:** macOS `screencapture -l <windowID>` can grab the Stream Deck app window programmatically. The window ID can be obtained via `osascript` or `GetWindowList`. Claude can also use browser automation tools to view/capture the app if it's visible.

This means visual verification is available now — no new MCP tools or hardware needed. It tests the full rendering pipeline: plugin SVG generation → Stream Deck SDK rendering → final pixel output.

---

## Proposed approach

Extend the MCP layer with test-support tools rather than building a separate harness. Tests run from a Claude session using tools already present in the conversation.

> **Note:** See `mcp-security-analysis.md` before implementing. The Phase 1 additions as originally proposed introduce critical AI safety issues. The scoped versions below reflect the mitigations from that review.

---

## Phased plan

### Phase 1 — State-driving tools (high value, low effort)

Add two new MCP tools with security constraints applied:

**`decky_inject_hook_event`** — POSTs to `/hook` with a specified event payload (PreToolUse, PostToolUse, Stop, AskUserQuestion, etc.). Enables driving the state machine into any state on demand.

**Security constraint:** Only available when `DECKY_TEST=1` is set in the bridge environment. The bridge refuses the endpoint in production mode. Never included in the production MCP server — a separate test-only MCP server registers this tool.

**`decky_send_action`** — Emits a Socket.io `action` event, **scoped to safe actions only**: `requestState` and `selectOption` (for AskUserQuestion testing). Explicitly excludes `approve`, `deny`, `cancel`, `macro`, `approveOnceInClaude`.

With these two tools (and the security constraints in place), testable scenarios include:
- State transitions (idle → awaiting-approval → idle)
- AskUserQuestion + selectOption flow
- Multi-session nonce deduplication
- Queue advancement after PostToolUse

**Not testable via MCP** (by design, for safety): approval/deny/cancel actions, macro text injection. These require a separate out-of-band test harness or manual testing.

**Deliverable:** Bridge test endpoint (gated on `DECKY_TEST=1`), 1–2 MCP tools in a test-only server config, initial test scenarios.

---

### Phase 2 — Visual verification via Stream Deck app screenshots (high value, low effort)

The Stream Deck app preview pane mirrors the physical device. Screenshotting the app window provides full-pipeline visual verification with no new tooling.

**Approach:**
1. Use `screencapture -l <windowID>` to capture the Stream Deck app window to a PNG
2. Compare against baseline screenshots stored in the repo
3. Drive state transitions (Phase 1 tools), capture after each transition, compare to expected baseline for that state

**What this covers:**
- Icon rendering correctness (SVG → PNG pipeline)
- Layout accuracy (correct slots active per state, correct positions)
- Color/theme application (backgrounds, icon tints, text colors)
- State-dependent visual changes (button highlights, active/inactive appearance)

**What this does not cover:**
- Logical slot metadata (labels, types, actions) — use `decky_get_status` / `slotHeartbeat` for this
- Pixel-perfect cross-platform rendering — tied to the macOS Stream Deck app

**Baseline management:** Store baseline PNGs per state (idle, awaiting-approval, thinking, executing, ask-user) in the repo. Perceptual hashing (e.g., via ImageMagick `compare`) handles minor anti-aliasing differences. A threshold-based comparison catches real regressions without false positives from subpixel rendering.

**Deliverable:** Capture script, baseline screenshots per state, comparison script with perceptual diff threshold.

---

### Phase 3 — Logical layout snapshots (medium value, low effort)

Visual screenshots verify what the user sees; logical snapshots verify the data driving it. Both are useful — screenshots catch rendering bugs that logical checks miss, and logical checks catch metadata errors that screenshots can't express.

The `/status` endpoint already returns deck layout. Formalize this into a verifiable contract.

**`decky_get_layout_snapshot`** — Returns current slot layout (index, label, icon, colors, type) in a normalized, diffable format.

Write expected-layout fixtures for each state. Each test verifies:
- Correct slots are active per state
- Labels and icons match the `layouts.ts` definitions
- Color theme is applied correctly
- Slot types and actions are correct

**Deliverable:** Layout snapshot tool, fixture files per state, comparison logic.

---

### Phase 4 — Scenario test scripts (high value, deferred)

Once Phases 1–3 are complete, write declarative scenario tests that exercise multi-step flows end-to-end, combining state injection, logical verification, and visual verification:

```
scenario: state-transitions
  - inject PreToolUse (tool: Bash)
  - assert state == awaiting-approval
  - assert approval queue has 1 pending
  - screenshot → compare to baseline/awaiting-approval.png
  - inject PostToolUse
  - assert state == idle
  - assert queue empty
  - screenshot → compare to baseline/idle.png

scenario: theme-change
  - set theme "monokai"
  - screenshot → compare to baseline/idle-monokai.png
  - set theme "dark"
  - screenshot → compare to baseline/idle-dark.png
```

These run in a Claude session, using the Phase 1 tools + screenshot capture, producing a pass/fail report with visual diffs on failure.

**Deliverable:** Scenario YAML/script format, test runner, initial scenario library.

---

## Summary

| Phase | What it unlocks | Effort | New infra needed |
|---|---|---|---|
| 1 — State-driving | State machine round-trips, AskUserQuestion | Low | Test-gated endpoint, 1–2 MCP tools |
| 2 — Visual verification | Full-pipeline rendering verification per state | Low | Capture script, baseline PNGs, diff script |
| 3 — Logical snapshots | Slot metadata verification per state | Low | 1 MCP tool, fixture files |
| 4 — Scenario scripts | Full scenario automation with visual + logical | Low (given P1–P3) | Test YAML/scripts |

Phase 1 is the highest-leverage first step — it converts the current read-only observer into a state-driving test harness. Phase 2 follows immediately with minimal effort since the Stream Deck app screenshot approach requires no new MCP tools or bridge changes. The security constraints (test-only gating, no approval actions exposed) are non-negotiable preconditions for implementing Phase 1 safely.
