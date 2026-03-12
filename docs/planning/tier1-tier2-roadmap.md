# Tier 1 + Tier 2 Feature Roadmap

Date: 2026-03-11
Scope: All T1 and T2 items from competitive-analysis.md
Format: 20-minute implementation chunks, each ending with tests passing + commit

---

## Status Summary

| ID | Feature | Status | Chunks |
|:---|:--------|:-------|:------:|
| T2-5 | Token rotation on bridge start | ✅ Already done (`security.ts:61` `rotateBridgeToken()`) | — |
| T1-3 | Session acknowledgment (done→idle guard) | ❌ Not started | 2 |
| T1-4 | Risk-level color coding for approvals | ❌ Not started | 3 |
| T2-2 | Multi-session concurrent approvals | 📄 Plan written (`multiple-claude-approvals.md`) | 4 |
| T1-1 | AskUserQuestion hook support | ❌ Not started | 4 |
| T2-1 | Always Allow (permanent approval) | ❌ Not started | 3 |
| T1-2 | Rate limit widget | ❌ Not started | 3 |
| T2-3 | npm package installer (@decky/setup) | ❌ Not started | 2 |
| T2-4 | Stream Deck+ encoder LCD support | ❌ Not started | 4 |

**Total: 25 chunks × 20 min ≈ 8–9 hours of implementation**

Order is dependency-first, quick wins first. T1-3 and T1-4 warm up the bridge+plugin pattern. T2-2 comes early because it touches `macro-exec-darwin.ts` independently. T2-4 is last because it is the most structurally novel.

---

## T1-3 — Session Acknowledgment (done → idle guard)

*Goal: When Claude finishes a task, hold in a `done` state until the user presses a key, preventing silent idle resets.*

### Chunk T1-3-A — State machine: add `done` state
**Files:** `bridge/src/state-machine.ts`, `bridge/src/__tests__/state-machine.test.ts`

- Add `"done"` to the `State` union type.
- Change `thinking:Stop` and `tool-executing:Stop` transitions from `→ idle` to `→ done`.
- Add `done:Stop → done` (no double-trigger).
- Add `done:PreToolUse → awaiting-approval` (new prompt arrives while in done).
- Add a `forceState("idle", ...)` path triggered by a new `"acknowledge"` hook event or via Socket.io action (the `restart` action already force-sets to idle — rename or alias).
- Keep `awaiting-approval:Stop → idle` (aborted session).
- Tests: verify `thinking+Stop → done`, `tool-executing+Stop → done`, `done+new PreToolUse → awaiting-approval`.
- ✅ Run tests. Commit: `feat(state-machine): add done state for task acknowledgment`.

### Chunk T1-3-B — Plugin: done layout + acknowledge action
**Files:** `plugin/src/layouts.ts`, `plugin/src/actions/slot.ts`, `plugin/src/__tests__/layouts.test.ts`

- Add `LAYOUTS["done"]` entry: slot 0 = green "Done ✓" button (action `"acknowledge"`), slot 1 = restart button, slots 2+ = empty.
- In `SlotAction.onKeyUp`, when `data.action === "acknowledge"`, emit Socket.io `action: "restart"` (which already force-sets to `idle`).
- Add slide-in animation for `idle → done` (same pattern as `idle → awaiting-approval`).
- Tests: `getSlotConfig("done", 0)` returns acknowledge config.
- ✅ Run tests. Commit: `feat(plugin): done state layout with acknowledge button`.

---

## T1-4 — Risk-Level Color Coding for Approvals

*Goal: Classify tool requests as safe/warning/critical and tint the Approve slot accordingly.*

### Chunk T1-4-A — Bridge config: risk rules schema
**Files:** `bridge/src/config.ts`, `bridge/src/__tests__/config.test.ts`

- Add to `DeckyConfig`:
  ```typescript
  toolRiskRules?: Array<{ pattern: string; risk: "safe" | "warning" | "critical" }>;
  ```
  Default: empty array (all tools = `"warning"` by default).
- Add `validateToolRiskRules()` validation: pattern must be non-empty string ≤ 64 chars; risk must be one of the three values; max 100 rules.
- Expose in `saveConfig()` and `loadConfig()`.
- Tests: valid rules save/load correctly; invalid pattern/risk rejected with `ConfigValidationError`.
- ✅ Run tests. Commit: `feat(config): add toolRiskRules for per-tool risk classification`.

### Chunk T1-4-B — Bridge: classify risk, include in statePayload
**Files:** `bridge/src/app.ts`, `bridge/src/__tests__/approval-workflow.test.ts`

- Add helper `classifyToolRisk(toolName, rules)` → `"safe" | "warning" | "critical"`. Matches tool name against patterns (exact match, then glob `*` wildcard, then default `"warning"`).
- Add `riskLevel: "safe" | "warning" | "critical" | null` to `ApprovalQueueItem` and `StatePayload.approval`.
- In `enqueueApprovalRequest`, call `classifyToolRisk` using current config.
- In `statePayload()`, include `approval.riskLevel`.
- Tests: `Bash` tool with rule `{ pattern: "Bash", risk: "critical" }` → `approval.riskLevel === "critical"` in state payload.
- ✅ Run tests. Commit: `feat(bridge): classify tool risk and include in statePayload`.

### Chunk T1-4-C — Plugin: risk-tinted approve slot
**Files:** `plugin/src/layouts.ts`, `plugin/src/bridge-client.ts`, `plugin/src/__tests__/layouts.test.ts`

- Add `riskLevel?: "safe" | "warning" | "critical" | null` to `StateSnapshot.approval` and `ApprovalUiMeta`.
- In `approveSlot()`, map risk to background color:
  - `"safe"` → `#22c55e` (green, current default)
  - `"warning"` → `#f59e0b` (amber)
  - `"critical"` → `#ef4444` (red)
  - `null/undefined` → `#22c55e` (safe default)
- Update `approvalInfoSVG` to show risk tier label ("Safe" / "Warning" / "Critical") as the bottom line.
- Tests: `getSlotConfig("awaiting-approval", 0, "Bash", undefined, { riskLevel: "critical", ... })` → SVG contains red background.
- ✅ Run tests. Commit: `feat(plugin): risk-level color coding on approval slots`.

---

## T2-2 — Multi-Session Concurrent Approvals

*Full plan in `docs/planning/multiple-claude-approvals.md`. Two independent parts: queue fix and window targeting fix.*

### Chunk T2-2-A — Bridge: nonce-based dedup + session context in queue
**Files:** `bridge/src/app.ts`

- Add `sessionId: string | null` and `cwd: string | null` to `ApprovalQueueItem`.
- Extract `session_id` and `cwd` from hook body in `/hook` route; pass through `applyHookPayload` options.
- Replace `duplicatePre` guard (line 270) with: `const alreadyQueued = nonce != null && approvalQueue.some(i => i.nonce === nonce); if (!alreadyQueued) { enqueueApprovalRequest(...) }`.
- No test yet (next chunk).

### Chunk T2-2-B — Bridge: state machine + statePayload + tests
**Files:** `bridge/src/state-machine.ts`, `bridge/src/app.ts`, `bridge/src/__tests__/multi-provider-queue.test.ts`

- Add `"awaiting-approval:PermissionRequest": "awaiting-approval"` to transition table.
- Add `requestId`, `sessionId`, `cwd` to `StatePayload.approval` (interface + `statePayload()` function).
- Update `multi-provider-queue.test.ts`:
  - Update "does NOT surface again for duplicate" → split into nonce-dedup test and concurrent-sessions test.
  - Add: two PermissionRequests with different nonces both enqueue → `pending: 2`; approve first → `pending: 1`; approve second → `idle`.
- ✅ Run tests. Commit: `feat(bridge): concurrent multi-session approval queue with nonce dedup`.

### Chunk T2-2-C — macOS window targeting: search all windows for active dialog
**Files:** `bridge/src/macro-exec-darwin.ts`, `bridge/src/__tests__/macro-exec.test.ts`

- Add new AppleScript helper `findAndClickApprovalInAnyWindow(processName, phase)` that:
  - Iterates all windows (and sheets within each window) of the target process.
  - Finds the first with an `AXDefaultButton` (approve) or `AXCancelButton` (dismiss).
  - Uses `AXRaise` on that specific window before clicking.
  - Returns `"clicked"` or `"not-found"`.
- In `approveInTargetApp("claude")`, call this as the **first** strategy before the existing `front window` strategies.
- Same change for `dismissClaudeApproval`.
- Tests: mock `osascript` to simulate two-window Claude process; verify correct window is targeted.
- ✅ Run tests. Commit: `fix(macro-exec): search all windows for active approval dialog`.

### Chunk T2-2-D — Plugin type updates + info slot project name
**Files:** `plugin/src/bridge-client.ts`, `plugin/src/layouts.ts`, `plugin/src/__tests__/layouts.test.ts`

- Add `sessionId?: string | null; cwd?: string | null` to `StateSnapshot.approval`.
- Add same to `ApprovalUiMeta`.
- In `approvalInfoSVG`, when `pending > 1` and `cwd` is non-null, show `basename(cwd)` as the bottom label instead of `"Info"`.
- Tests: `approvalInfoSVG("Bash", { pending: 2, cwd: "/Users/bill/myproject", ... })` → SVG contains "myproject".
- ✅ Run tests. Commit: `feat(plugin): show project name on approval info slot for multi-session queue`.

---

## T1-1 — AskUserQuestion Hook Support

*Goal: When Claude presents a multiple-choice question, map options to StreamDeck buttons.*

### Chunk T1-1-A — Bridge: new event + state + payload extraction
**Files:** `bridge/src/state-machine.ts`, `bridge/src/app.ts`

- Add `"AskUserQuestion"` to `HookEvent` union and `VALID_EVENTS` set.
- Add `"asking"` to `State` union with transitions:
  - `idle/thinking/tool-executing:AskUserQuestion → asking`
  - `asking:Stop → idle`
  - `asking:PostToolUse → idle`
- Add `options: Array<{ label: string; value?: string }> | null` to `HookPayload`.
- In `/hook` route, extract `options` from body (`body.options` array, max 8 items, each label ≤ 80 chars).
- Add `optionSelected: string | null` to `StatePayload` (set when user picks; null otherwise).
- No user-facing change yet.

### Chunk T1-1-B — Bridge: enqueue + selection Socket.io action + tests
**Files:** `bridge/src/app.ts`, `bridge/src/__tests__/approval-workflow.test.ts`

- In `applyHookPayload`, when event is `AskUserQuestion`: store options on a new `pendingQuestion` struct (question text + options), force state to `asking`, emit stateChange with options included in payload.
- Add Socket.io action `"selectOption"` with `{ index: number }`. When received in `asking` state:
  - Look up `options[index]`, write selection to a response file OR emit back to hook via same gate-file mechanism (or stdout of the hook script that stays alive).
  - Force state to `idle`.
  - Emit stateChange.
- Tests: POST AskUserQuestion event → state becomes `asking`; selectOption(1) → state becomes `idle`.
- ✅ Run tests. Commit: `feat(bridge): AskUserQuestion event handling and option selection`.

### Chunk T1-1-C — Plugin: asking layout (option buttons on slots 0–3)
**Files:** `plugin/src/layouts.ts`, `plugin/src/bridge-client.ts`

- Extend `StateSnapshot` with `options?: Array<{ label: string }> | null`.
- Add `LAYOUTS["asking"]` or dynamic builder:
  - Slots 0–3: one button per option (label text, neutral blue background, action `"selectOption"` + `index`).
  - If fewer than 4 options, remaining slots show empty.
  - If more than 4 options, slot 3 shows "More…" (cycles to next page — stretch goal; skip for now, cap at 4 options).
- Add SVG generator `optionButtonSVG(label, index)`.
- Tests: `getSlotConfig("asking", 0, null, undefined, null, options)` returns option 0 config.
- ✅ Run tests (layouts only). No commit yet.

### Chunk T1-1-D — Plugin: SlotAction wiring + integration tests
**Files:** `plugin/src/actions/slot.ts`, `plugin/src/__tests__/slot-action.render.test.ts`

- In `SlotAction.onKeyUp`, when `data.action === "selectOption"`, emit `{ action: "selectOption", index: data.index }` to bridge.
- Add slide-in animation transition for `* → asking` state.
- Integration test: mock bridge sends `asking` state with 3 options → slots 0–2 render option buttons, slot 3 empty.
- ✅ Run tests. Commit: `feat(plugin): AskUserQuestion option buttons on StreamDeck slots`.

---

## T2-1 — Always Allow (Permanent Approval)

*Goal: User can mark a tool as permanently approved; future requests skip the approval UI.*

### Chunk T2-1-A — Bridge config: alwaysAllowRules schema
**Files:** `bridge/src/config.ts`, `bridge/src/__tests__/config.test.ts`

- Add to `DeckyConfig`:
  ```typescript
  alwaysAllowRules?: Array<{ pattern: string; createdAt: number; id: string }>;
  ```
  Default: empty array.
- Validation: pattern ≤ 64 chars, non-empty; max 200 rules; id must be non-empty.
- Add REST routes in `app.ts`:
  - `GET /rules` → returns current rules list.
  - `POST /rules` body `{ pattern }` → appends rule, saves config, returns updated list.
  - `DELETE /rules/:id` → removes matching rule, saves config.
- Tests: round-trip save/load; invalid pattern rejected; GET/POST/DELETE endpoints return correct shapes.
- ✅ Run tests. Commit: `feat(config): alwaysAllowRules schema and REST API`.

### Chunk T2-1-B — Bridge: auto-approve matching tools
**Files:** `bridge/src/app.ts`, `bridge/src/__tests__/approval-workflow.test.ts`

- In `applyHookPayload`, before enqueueing a PermissionRequest/PreToolUse:
  - Load current `alwaysAllowRules` from config.
  - Check if tool name matches any rule pattern (exact match; `*` wildcard suffix).
  - If matched: in mirror flow, call `approveOnceInClaude()` immediately and skip queue; in gate flow, write `approve` to gate file immediately and skip queue.
  - Emit stateChange with `autoApproved: true` flag on the approval field (informational).
- Tests: tool `"Read"` with rule `{ pattern: "Read" }` → no queue entry, `approveOnceInClaude` called; tool `"Bash"` without matching rule → queued normally.
- ✅ Run tests. Commit: `feat(bridge): auto-approve tools matching alwaysAllowRules`.

### Chunk T2-1-C — Plugin: Always Allow button (slot 3 or new slot)
**Files:** `plugin/src/layouts.ts`, `plugin/src/actions/slot.ts`, `plugin/src/__tests__/layouts.test.ts`

- Rearrange awaiting-approval layout: move info slot from 3 to 2 (or keep 3 and add "Always Allow" as a 5th action slot if hardware has room).
  - Simpler approach: slot 3 = "Always Allow" button (purple background, ∞ icon, action `"alwaysAllow"`).
  - Previous info SVG moves to slot title text only (no dedicated slot).
- In `SlotAction.onKeyUp`, when `data.action === "alwaysAllow"`:
  - Emit `{ action: "alwaysAllow", pattern: currentTool }` to bridge.
  - Bridge handler: POST to `/rules` with current tool name, then approve.
- Tests: awaiting-approval slot 3 renders Always Allow button; action triggers correct event.
- ✅ Run tests. Commit: `feat(plugin): Always Allow button in approval layout`.

---

## T1-2 — Rate Limit Widget

*Goal: Show Claude's 5-hour token rate-limit consumption on a widget slot.*

**Data source decision:** Claude Code's `Stop` hook payload includes a `usage` field in some versions (input/output tokens). If present, the bridge accumulates a rolling 5-hour total. If not present in the payload, the bridge accepts an explicit `POST /rate-limit` from a user script or future hook. We ship the accumulation infrastructure and a widget that displays whatever data has been seen.

### Chunk T1-2-A — Bridge: rate limit accumulation + endpoint
**Files:** `bridge/src/app.ts`, `bridge/src/rate-limit.ts` (new)

- Create `bridge/src/rate-limit.ts`:
  - `RateLimitStore` class: in-memory ring buffer of usage entries (timestamp + tokens).
  - `addUsage(inputTokens, outputTokens)` → appends entry, prunes entries older than 5 hours.
  - `getSummary()` → `{ totalTokens5h: number, resetAt: number | null, percentUsed: number | null }`.
- In `applyHookPayload`, when event is `Stop` and body contains `usage.input_tokens` / `usage.output_tokens`, call `rateLimitStore.addUsage(...)`.
- Add `GET /rate-limit` endpoint → returns `rateLimitStore.getSummary()`.
- Add `POST /rate-limit` endpoint (accepts `{ inputTokens, outputTokens, limitTokens5h? }`) for manual/external updates.
- Include `rateLimit: getSummary() | null` in `statePayload()`.
- Tests: `addUsage` + `getSummary` accumulates correctly; entries older than 5h pruned; endpoint returns correct shape.
- ✅ Run tests. Commit: `feat(bridge): rate limit accumulation and /rate-limit endpoint`.

### Chunk T1-2-B — Plugin: rate-limit widget kind
**Files:** `plugin/src/layouts.ts`, `plugin/src/bridge-client.ts`, `plugin/src/__tests__/layouts.test.ts`

- Add `rateLimit?: { totalTokens5h: number; percentUsed: number | null; resetAt: number | null } | null` to `StateSnapshot`.
- Add `kind: "rate-limit"` to `WidgetDef` union.
- Add `rateLimitWidgetSVG(data)` renderer:
  - Arc or bar gauge showing % consumed (green → amber → red thresholds at 60/85%).
  - "≈Xk tok / 5h" label.
  - Reset time countdown if `resetAt` known.
  - "No data" placeholder if `percentUsed` is null.
- Wire widget refresh to `stateChange` events (rate limit included in every state broadcast).
- Tests: `rateLimitWidgetSVG({ percentUsed: 82, ... })` → SVG contains amber arc.
- ✅ Run tests. Commit: `feat(plugin): rate-limit widget slot`.

### Chunk T1-2-C — Config schema + default widget + docs
**Files:** `bridge/src/config.ts`, `bridge/src/__tests__/config.test.ts`

- Add `"rate-limit"` to `WidgetDef` kind validation.
- Add default rate-limit widget to `DEFAULT_MACROS` (slot 6 or user-configurable position).
- `maxTokens5h` optional config field (defaults to null = show raw counts; if set, enables % calculation even without Stop-event data).
- Config validation: `maxTokens5h` must be a positive integer if present.
- Tests: config with `kind: "rate-limit"` round-trips; maxTokens5h validation.
- ✅ Run tests. Commit: `feat(config): rate-limit widget config and default slot`.

---

## T2-3 — npm Package Installer (@decky/setup)

*Goal: `npx @decky/setup` replaces `git clone && ./install.sh`.*

### Chunk T2-3-A — Root package.json + setup.mjs
**Files:** `package.json` (new, root), `setup.mjs` (new, root)

- Create `package.json`:
  ```json
  {
    "name": "@decky/setup",
    "version": "0.1.0",
    "type": "module",
    "bin": { "decky-setup": "./setup.mjs" },
    "engines": { "node": ">=20" },
    "files": ["setup.mjs", "hooks/"]
  }
  ```
- Create `setup.mjs` (executable, `#!/usr/bin/env node`):
  1. Check Node ≥ 20 and npm.
  2. Check that `@elgato/cli` is installed or Stream Deck software path exists.
  3. Check `jq` (macOS/Linux) for hook config merging.
  4. `npm install --prefix bridge && npm run build --prefix bridge`.
  5. `npm install --prefix plugin && npm run build --prefix plugin`.
  6. Port the `install.sh` logic: copy hook scripts to `~/.decky/hooks/`, merge `settings.json`.
  7. Print "✅ Decky is ready. Run: node bridge/dist/server.js".
- Manual test: `node setup.mjs` from repo root succeeds.
- ✅ Commit: `feat: @decky/setup npm installer script`.

### Chunk T2-3-B — README update + publish prep
**Files:** `README.md`, `.npmignore` (new)

- Add `npx @decky/setup` as the primary install method in README (above the manual method).
- Create `.npmignore` to exclude test files, screenshots, planning docs from npm package.
- Verify `npm pack` produces a sane tarball (< 500 KB, includes hooks/ and setup.mjs).
- Update `package.json` with `repository`, `homepage`, `keywords` fields.
- ✅ Commit: `docs: add npx @decky/setup install method to README`.
- Note: actual `npm publish` is a manual step (not automated here).

---

## T2-4 — Stream Deck+ Encoder LCD Support

*Goal: Show approval queue count and tool name on encoder LCDs; dial press = approve.*

### Chunk T2-4-A — EncoderAction class skeleton
**Files:** `plugin/src/actions/encoder.ts` (new), `plugin/src/plugin.ts`, `plugin/src/bridge-client.ts`

- Create `EncoderAction` extending `streamDeck.actions.Action` (or appropriate SDK base for encoder/dial).
- Register in `plugin.ts` alongside `SlotAction`.
- Add manifest entry in `com.decky.controller.sdPlugin/manifest.json` for the encoder action UUID.
- On `client.on("stateChange")`, store latest snapshot in the encoder action.
- No visual output yet — just connection.
- ✅ Run tests (smoke test: encoder action class instantiates without error). Commit: `feat(plugin): EncoderAction skeleton for Stream Deck+`.

### Chunk T2-4-B — Touch strip: pending count + state label
**Files:** `plugin/src/actions/encoder.ts`

- Implement `setFeedback()` call with:
  - **Title area (top LCD):** current state label (`"Awaiting Approval"`, `"Idle"`, etc.).
  - **Value area (center):** pending approval count (e.g., `"2 pending"`) or empty when idle.
  - **Indicator bar:** filled proportional to `approvalTimeout` countdown when in `awaiting-approval`.
- Update feedback on every `stateChange` event.
- Manual test: with SD+ connected, approval request → touch strip shows count. (Automated test: mock `setFeedback` and verify it's called with correct shape.)
- ✅ Run tests. Commit: `feat(plugin): encoder touch strip shows approval count and state`.

### Chunk T2-4-C — Dial press = approve; rotation = scroll queue
**Files:** `plugin/src/actions/encoder.ts`

- On `dialDown` (encoder press): if state is `awaiting-approval`, emit `{ action: "approve" }` to bridge socket.
- On `dialRotate` clockwise (if queue `pending > 1`): cycle preview of next queued item (tool name, project name if cwd available) on the LCD — no action taken, just informational preview.
- On `dialRotate` counter-clockwise: cycle back.
- ✅ Run tests. Commit: `feat(plugin): dial press to approve, rotate to preview queue`.

### Chunk T2-4-D — Rate limit display on encoder + tests
**Files:** `plugin/src/actions/encoder.ts`, `plugin/src/__tests__/encoder.test.ts` (new)

- If `statePayload.rateLimit.percentUsed` is available, show it on a secondary LCD panel (if SD+ has multiple LCDs) or as a subtitle beneath the state label.
- Color-code the indicator: green < 60%, amber 60–85%, red > 85%.
- Create `plugin/src/__tests__/encoder.test.ts`:
  - Mock SDK encoder action API.
  - Verify `setFeedback` called with correct structure for idle / awaiting-approval / rate-limit-red states.
- ✅ Run all tests (bridge + plugin). Commit: `feat(plugin): rate limit on encoder LCD with color thresholds`.

---

## End-of-roadmap notes

**Per the project checklist:** each chunk above ends with tests passing and a commit. Do not batch commits across chunks.

**Sequencing rationale:**
- T1-3 before T1-1: `done` state lands in the state machine before `asking` state to avoid merge confusion.
- T2-2 before T1-1: `macro-exec-darwin.ts` window-targeting fix is isolated; do it early to avoid conflict with later touch.
- T2-1 after T1-4: both touch config schema — T1-4 adds `toolRiskRules`, T2-1 adds `alwaysAllowRules`, sequential avoids conflicts.
- T1-2 after T2-2: rate limit data flows through `statePayload`; the multi-session statePayload extension (T2-2-B) should land first.
- T2-4 last: most novel, depends on all state machine and statePayload changes being stable.
