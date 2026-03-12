# Decky Live Test Suite: MCP-Based Approach

## What the MCP layer already enables

The 25 MCP tools give live read/write access to almost everything stateful:

| Capability | Coverage |
|---|---|
| Bridge health, state, uptime | Full |
| Config (macros, theme, colors, rules) | Full CRUD |
| Approval queue inspection | Full |
| Debug trace + logs | Full (DECKY_DEBUG=1) |
| Deck layout (via slotHeartbeat) | Read-only |

This is a strong foundation. Config round-trips, color/theme changes, and state inspection can all be exercised live in a Claude session right now.

---

## Gap analysis

Three hard gaps prevent closed-loop testing today:

### Gap 1: No way to drive state transitions
The bridge's state machine transitions via `POST /hook` (PreToolUse, PostToolUse, Stop, etc.), but there is no MCP tool exposing that endpoint. Without this, state can only be observed — not injected — so approval flows, AskUserQuestion handling, cancellation, etc. cannot be tested end-to-end.

### Gap 2: No way to send approval actions
Approve/deny/cancel/macro actions go through Socket.io, not HTTP. No MCP tool exists for this. A full approval round-trip (inject PreToolUse → verify state → approve → verify idle) is not currently possible.

### Gap 3: No visual verification of the deck
The physical Stream Deck renders SVG/PNG icons per state. The `/status` endpoint returns the logical layout (slot labels, active slots, heartbeat metadata) but not a pixel image. Elgato's SDK does not expose a screenshot API. Options for visual verification:
- **Logical layout comparison**: compare slot labels/icons/colors to expected spec (partially in place via `slotHeartbeat`)
- **Screenshot of physical hardware**: requires camera or screen capture rig — fragile
- **Headless icon hash**: render icons via `generate-icons.mjs`, compare checksums to baseline

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

**`decky_send_action`** — Emits a Socket.io `action` event, **scoped to safe actions only**: `requestState` and `selectOption` (for AskUserQuestion testing). Explicitly excludes `approve`, `deny`, `cancel`, `macro`, `alwaysAllow`, `approveOnceInClaude`.

With these two tools (and the security constraints in place), testable scenarios include:
- State transitions (idle → awaiting-approval → idle)
- AskUserQuestion + selectOption flow
- Multi-session nonce deduplication
- Queue advancement after PostToolUse

**Not testable via MCP** (by design, for safety): approval/deny/cancel actions, macro text injection. These require a separate out-of-band test harness or manual testing.

**Deliverable:** Bridge test endpoint (gated on `DECKY_TEST=1`), 1–2 MCP tools in a test-only server config, initial test scenarios.

---

### Phase 2 — Layout snapshot testing (medium value, medium effort)

The `/status` endpoint already returns deck layout. Formalize this into a verifiable contract.

**`decky_get_layout_snapshot`** — Returns current slot layout (index, label, icon, colors, type) in a normalized, diffable format.

Write expected-layout fixtures for each state. Each test verifies:
- Correct slots are active per state
- Labels and icons match the `layouts.ts` definitions
- Color theme is applied correctly

This is a logical substitute for visual screenshots: it tests what the plugin *sends* to the deck rather than what pixels appear. It catches configuration/logic errors but not SVG rendering bugs.

**Deliverable:** Layout snapshot tool, fixture files per state, comparison logic.

---

### Phase 3 — Icon rendering verification (lower priority)

The `generate-icons.mjs` script already produces PNG icons.

**Approach (recommended):** Headless render + perceptual hash. Run `generate-icons.mjs`, hash each output, compare against baseline hashes stored in the repo. Fails if icon output changes unexpectedly. Suitable for CI.

**Alternatives considered:**
- Stream Deck simulator: no off-the-shelf option; building one is significant work
- Camera/screen capture: fragile, requires external hardware

**Deliverable:** Hash baseline file, CI step to regenerate and compare.

---

### Phase 4 — Scenario test scripts (high value, deferred)

Once Phases 1–2 are complete, write declarative scenario tests that exercise multi-step flows end-to-end:

```
scenario: state-transitions
  - inject PreToolUse (tool: Bash)
  - assert state == awaiting-approval
  - assert approval queue has 1 pending
  - inject PostToolUse
  - assert state == idle
  - assert queue empty

```

These run in a Claude session, using the Phase 1 tools, producing a pass/fail report.

**Deliverable:** Scenario YAML/script format, test runner, initial scenario library.

---

## Summary

| Phase | What it unlocks | Effort | New infra needed |
|---|---|---|---|
| 1 — State-driving | State machine round-trips, AskUserQuestion | Low | Test-gated endpoint, 1–2 MCP tools |
| 2 — Layout snapshots | Slot/icon/color verification per state | Medium | 1 MCP tool, fixture files |
| 3 — Icon hashing | Rendering regression detection | Low–medium | Hash baseline + CI step |
| 4 — Scenario scripts | Full scenario automation | Low (given P1+P2) | Test YAML/scripts |

Phase 1 is the highest-leverage first step — it converts the current read-only observer into a state-driving test harness. The security constraints (test-only gating, no approval actions exposed) are non-negotiable preconditions for implementing it safely.
