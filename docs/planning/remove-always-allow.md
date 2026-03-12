# Implementation Plan: Remove Always-Allow Feature

**Decision:** The always-allow feature is removed entirely from Decky. No rules are stored,
matched, or managed anywhere in the codebase. Responsibility for always-allow decisions
belongs exclusively to Claude.app's native approval mechanism. Enabling power users to manage
these rules in a Decky context is an anti-goal.

This resolves the Critical security finding documented in `mcp-security-analysis.md`.

---

## Scope

13 files change. 1 file is deleted. No new files are created.

---

## Bridge

### `bridge/src/config.ts`

Remove the `AlwaysAllowRule` type and everything that references it:

- Delete `interface AlwaysAllowRule` (lines ~79–84)
- Remove `alwaysAllowRules: AlwaysAllowRule[]` from `DeckyConfig` interface
- Remove `alwaysAllowRules: []` from the default config object
- Delete `const MAX_ALWAYS_ALLOW_RULES = 200`
- Delete `const MAX_ALWAYS_ALLOW_PATTERN_LENGTH = 64`
- Delete `function normalizeAlwaysAllowRules()`
- Remove `alwaysAllowRules: normalizeAlwaysAllowRules(...)` from `loadConfig()` normalization
- Delete `export function getAlwaysAllowRules()`
- Delete `export function addAlwaysAllowRule()`
- Delete `export function removeAlwaysAllowRule()`
- Remove the `alwaysAllowRules` validation block from `updateConfig()` (~lines 670–687)
- Remove `alwaysAllowRules: ...` from the merged config object in `updateConfig()` (~lines 749–751)

### `bridge/src/app.ts`

Remove the always-allow check and all rule-management API surface:

- Delete `function matchesAlwaysAllow()` and its import of `getAlwaysAllowRules`
- Remove the auto-approve block in the hook handler:
  ```ts
  if (matchesAlwaysAllow(toolName)) { ... }
  ```
- Remove `GET /rules` endpoint
- Remove `POST /rules` endpoint
- Remove `DELETE /rules/:id` endpoint
- Remove `"alwaysAllow"` from the `THROTTLE_EXEMPT` set
- Delete the `alwaysAllow` socket action handler block (`else if (data.action === "alwaysAllow")`)

### `bridge/src/__tests__/config.test.ts`

- Delete the `"/rules endpoints (alwaysAllowRules)"` describe block

### `bridge/src/__tests__/approval-workflow.test.ts`

- Delete the `"alwaysAllow socket action"` describe block (3 tests)
- Delete the `"alwaysAllow auto-approve"` describe block
- Remove `saveConfig({ alwaysAllowRules: [] })` cleanup calls in remaining tests
  (no longer needed once the field is gone from the schema)

---

## MCP

### `mcp/src/tools/rules.ts`

**Delete this file entirely.** It contains only the three always-allow MCP tools
(`decky_list_always_allow_rules`, `decky_add_always_allow_rule`,
`decky_delete_always_allow_rule`).

### `mcp/src/server.ts`

- Remove `import { registerRulesTools }` line
- Remove `registerRulesTools(server, bridge)` call

### `mcp/src/tools/config-read.ts`

- Remove the phrase "and always-allow rules" from the `decky_get_config` tool description

### `mcp/src/tools/debug.ts`

- Remove the `alwaysAllowRuleCount` field from the `decky_get_debug_info` response object
- Remove the `alwaysAllowRules` count field from the `decky_get_pi_debug_status` response object

### `mcp/src/__tests__/tools.test.ts`

- Delete the `"rules tools"` describe block (5 tests)
- Remove `alwaysAllowRules: []` from any mock config objects (cosmetic cleanup)

---

## Plugin

### `plugin/src/layouts.ts`

Slot index 3 of the awaiting-approval layout currently renders the Always Allow button.
Replace it with an info slot showing the tool name on a provider-colored background.

`approvalInfoSVG(toolName, approval)` already exists and does this: tool name centered,
background color from `TARGET_BADGE_COLORS[app]` (keyed to Claude vs Codex logo color),
provider code + queue position at top, project name at bottom for multi-session queues.
It just needs to be wired back into slot 3.

- Delete `function alwaysAllowSlot()`
- Add `function approvalInfoSlot(toolName, approval): SlotConfig` that wraps `approvalInfoSVG`
  and returns a non-interactive `SlotConfig` (no `action`, no `data`) — display-only
- In `getSlotConfig`, replace:
  ```ts
  if (slotIndex === 3) return alwaysAllowSlot(toolName);
  ```
  with:
  ```ts
  if (slotIndex === 3) return approvalInfoSlot(toolName, approval);
  ```
- In `buildFullLayout`, replace:
  ```ts
  3: alwaysAllowSlot(null)
  ```
  with:
  ```ts
  3: approvalInfoSlot(toolName, approval)
  ```
  (passing through the same `toolName` and `approval` parameters already available at that
  call site)
- Remove the `alwaysAllow` case from any switch/dispatch logic that maps action strings to
  handlers

### `plugin/src/bridge-client.ts`

- Remove `alwaysAllowRules?: Array<...>` from the status/config type definition

### `plugin/src/__tests__/layouts.test.ts`

- Update the two tests that assert `config.action === "alwaysAllow"` on slot 3 of the
  awaiting-approval layout. Replace with assertions on the new info slot: no action present,
  SVG contains the tool name, background matches the provider palette color.

---

## Manifest

### `plugin/com.decky.controller.sdPlugin/manifest.json`

The grep showed no always-allow action registration in the manifest, so no change is needed
here. Confirm during implementation.

---

## Checklist (end-of-phase)

- [ ] `npm test` passes in `bridge/`
- [ ] `npm test` passes in `mcp/`
- [ ] `npm test` passes in `plugin/`
- [ ] `npm run build` succeeds in `plugin/`
- [ ] Bridge starts cleanly; existing `~/.decky/config.json` files with `alwaysAllowRules`
      arrays load without error (the field should be silently ignored or stripped on load)
- [ ] Commit: `bridge + mcp + plugin: remove always-allow feature`

---

## Migration note

Existing `~/.decky/config.json` files may contain an `alwaysAllowRules` array. After the
`alwaysAllowRules` field is removed from the schema, `loadConfig()` will simply ignore any
unknown fields during normalization (verify this is the current behavior — if not, add explicit
stripping). No migration script is needed; the data is inert once the matching logic is gone.
