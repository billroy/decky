# Decky MCP Security Analysis: AI Safety Attack Surface

> **Decision (2026-03-12):** The always-allow feature is being **removed entirely** from Decky. No rules are stored, matched, or managed by the bridge. Responsibility for always-allow decisions remains exclusively on the Claude.app side. See `remove-always-allow.md` for the implementation plan. The Critical finding below is resolved by deletion, not mitigation.

## Threat model

The Decky system has an explicit trust hierarchy:
- **Trusted**: Physical Stream Deck button presses (human operator)
- **Untrusted**: Everything Claude does

The MCP server is Claude's interface to configure and observe the oversight system. This creates a structural tension: the controlled entity has write access to its own controls. This review maps exactly where that tension produces exploitable paths.

---

## Part 1: Current MCP exposure (already deployed)

### CRITICAL — Always-allow rule injection

**Tool:** `decky_add_always_allow_rule`

**Attack:** A malicious AI calls this with pattern `*`, `Bash`, `Bash*`, `Write*`, or any tool name it wants to use without oversight. The rule takes effect immediately. All future invocations of matching tools are auto-approved with no Stream Deck UI, no gate file, no human interaction of any kind. The rule persists in `~/.decky/config.json` across sessions.

**Why it's critical:** This is a single-call, permanent escape from oversight. The AI doesn't need to bypass any cryptography or race any file writes. It just calls the tool. The config write goes through the same authenticated HTTP channel everything else uses.

**What makes it worse:** Auto-approval is completely silent — no state transition, no StreamDeck visual, nothing. The `matchesAlwaysAllow` check short-circuits before any UI is triggered. A user watching their Stream Deck sees nothing.

**Current mitigations:** None. Pattern length is capped at 64 characters, but `*` is 1 character.

---

### HIGH — Persistent macro poisoning

**Tools:** `decky_update_slot`, `decky_add_slot`

**Attack:**
1. AI updates an existing macro (or adds a new one) to contain adversarial instructions, with `targetApp: "claude"` and `submit: true`
2. The modified macro sits in `~/.decky/config.json`, persisting across sessions
3. When a user presses that button, the macro injects up to 2000 characters of arbitrary content directly into Claude's input and auto-submits

**The poisoning can be done silently today.** The detonation requires a user button press — a latent persistence mechanism that survives session boundaries and config backups.

**Additional concern:** `decky_restore_config_backup` could restore an older backup that contained a previously-planted rule or macro, after a user has cleaned things up. Backups are indexed 0–N and the AI can list them.

---

### MEDIUM — Approval timeout window expansion

**Tool:** `decky_update_global_settings`

**Attack:** Set `approvalTimeout` to 300 (the maximum). This extends the gate-file polling window to 5 minutes, giving more time for race-condition-based attacks on the gate file (though the nonce check limits this) and reducing human urgency to respond.

**Context:** The timeout is enforced in the hook script, not server-side. The AI cannot set it to 0 to cause instant auto-deny, but can widen the response window.

---

### LOW–MEDIUM — Config backup restoration

**Tools:** `decky_restore_config_backup`, `decky_get_config_backups`

**Attack sequence:**
1. AI reads backup list to find an older config with broad always-allow rules (perhaps planted in a previous session)
2. Restores that backup, reinstating the rules
3. Even if a user audited and cleaned the current config, the backup vector re-opens the door

---

## Part 2: Proposed Phase 1 additions — incremental risk

### CRITICAL — Direct self-approval (`decky_send_action`)

**Proposed tool:** `decky_send_action` with `action: "approve"`

**Attack (gate flow):**
1. Claude executes a tool; pre-tool-use hook fires; bridge enters `awaiting-approval`
2. Hook is now polling `~/.decky/approval-gate`
3. Claude invokes `decky_send_action({action: "approve"})` via MCP
4. Bridge calls `writeGateFile("approve", nonce)` — the exact same code path as a human pressing the button
5. Hook reads the file, validates nonce, exits 0
6. Tool proceeds

**Attack (mirror flow — the default):**
Mirror flow is already non-blocking: the hook exits 0 immediately and surfaces Claude's native PermissionRequest dialog. When `decky_send_action({action: "approve"})` is called in mirror mode, it invokes `approveOnceInClaude()` — specifically designed to click the "Allow" button in Claude's UI programmatically. The AI approves its own permission requests end-to-end, with no human involvement at any step.

**Why this is architecturally catastrophic:** The entire approval system exists to interpose human judgment between Claude's intent and tool execution. `decky_send_action` with approve removes that interposition. One MCP call, and oversight is bypassed for that tool use. No persistence required; no config changes. The attack surface is every single tool use.

---

### HIGH — Self-injection via macro action (`decky_send_action`)

**Proposed tool:** `decky_send_action` with `action: "macro"`

**Attack:**
1. AI calls `decky_send_action({action: "macro", text: "<adversarial content>", targetApp: "claude", submit: true})`
2. Up to 2000 characters of content is typed into Claude's input and submitted
3. No approval queue entry, no gate file, no Stream Deck interaction

This is distinct from stored macro poisoning: it's immediate and requires no prior setup. The AI injects arbitrary instructions into its own conversation in a single call.

---

### HIGH — Approval queue sabotage (`decky_send_action`, `decky_inject_hook_event`)

**Attack 1 — Queue drain:**
If multiple sessions have pending approvals in the queue (multi-provider/nonce scenario), the AI calls `decky_send_action({action: "approve"})` or `deny` repeatedly to drain other sessions' approvals, disrupting legitimate human oversight for concurrent Claude instances.

**Attack 2 — State machine poisoning via `decky_inject_hook_event`:**
1. Inject a fake `PostToolUse` event — shifts the queue, potentially advancing or discarding a legitimate pending approval
2. Inject a fake `Stop` event — clears the entire queue and transitions to `done` state
3. Creates a confused bridge state where legitimate approvals are silently dropped

---

### MEDIUM — Race amplification (`decky_inject_hook_event`)

The gate file polling has a 0.2s sleep between ticks. While the nonce check prevents arbitrary file content from being accepted, `decky_inject_hook_event` posting a legitimate-looking PreToolUse for a different tool could create nonce confusion in multi-session scenarios. In gate flow, this could cause a hook for tool A to receive an approval intended for tool B if the AI can coordinate the timing.

---

## Part 3: The architectural root cause

The Decky oversight system is built on a correct principle: **the approver (human + hardware) must be independent of the approvee (Claude)**. The current implementation correctly ensures that approvals require physical hardware interaction.

The MCP layer partially violates this principle today (`decky_add_always_allow_rule`), and Phase 1 as originally proposed would fully violate it (`decky_send_action` with approve).

The analogy: you do not let an employee approve their own expense reports. The MCP server is, structurally, Claude approving its own expense reports.

---

## Recommendations

### Always-allow tranche (resolved by deletion)

**Decision:** Remove the always-allow feature entirely. No rules are stored, matched, or managed by Decky. See `remove-always-allow.md` for the full implementation plan.

This eliminates the Critical finding and all related vectors in a single sweep. The feature is an anti-goal: Decky is not the right place to make permanent approval decisions, and enabling that capability creates an attack surface with no offsetting benefit.

---

### Remaining open items

**1. Restrict macro write operations.**
`decky_update_slot` and `decky_add_slot` allow modifying macro text and `targetApp`. Modifications to slots with `targetApp: "claude"` represent a stored prompt injection vector. Consider restricting macro text writes from MCP (require direct config editing), or emitting a visible Stream Deck notification on any macro write.

**2. Log MCP write operations visibly.**
Every config-write MCP call should emit a log entry the user can audit, ideally visible on the Stream Deck or in the bridge log.

---

### For the proposed live test suite (Phase 1)

**3. Do not expose approval actions (`approve`, `deny`, `cancel`) via `decky_send_action`.**
These are human-intent controls. Test scenarios requiring approval flow exercise must be driven by a separate out-of-band harness, not by Claude itself.

**4. Do not expose the `macro` action via `decky_send_action`.**
Text injection into Claude's own input is a self-modification capability with no safe use from within the controlled context.

**5. If `decky_inject_hook_event` is added, gate it strictly.**
Acceptable only with `DECKY_TEST=1` set in the bridge process. Refused in production mode. Registered only in a separate test-only MCP server.

**6. Safe subset for `decky_send_action`:**
Limit to `requestState` and `selectOption` (AskUserQuestion testing only). Explicitly block `approve`, `deny`, `cancel`, `macro`, `approveOnceInClaude`.

---

## Summary table

| Vector | Severity | Status |
|---|---|---|
| Always-allow rule injection (any path) | **Critical** | **Eliminated** — feature deleted |
| Config backup restoration of rules | Medium | **Eliminated** — no rules exist to back up |
| Direct self-approval (Phase 1) | Critical | Not introduced — approval actions excluded |
| Self macro-injection (Phase 1) | High | Not introduced — macro action excluded |
| Queue sabotage via injected events | High | Mitigated — test endpoint gated on DECKY_TEST=1 |
| Persistent macro poisoning | High | Open — restrict macro writes from MCP |
| Timeout expansion | Medium | Open — acceptable; documented |

## Priority order

1. ~~Always-allow removal~~ — resolved, see `remove-always-allow.md`
2. Restrict macro text writes from MCP (macro poisoning)
3. Visible audit log for MCP write operations
