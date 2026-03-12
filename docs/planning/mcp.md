# Decky MCP Server — Specification & Reference

**Date:** 2026-03-11 (updated 2026-03-12)
**Status:** Implemented. This document is now a reference spec. All tranches (T0–T11) are complete.

---

## 1. Goals

1. Claude.app can read and write every configuration element of a Decky installation — themes, slot types, labels, icons, colors, macros, global settings — through natural language.
2. Claude.app can query bridge status and connection health without opening a browser.
3. Claude.app can read recent bridge logs and approval-trace history for closed-loop debugging.
4. The MCP surface introduces no new security vulnerabilities relative to the existing bridge.

### Example commands that work

```
"Set the icon on the second Proceed button on my Decky to the stop sign and make it green"
"Change the background on alternate buttons to green/yellow"
"Switch the Push and MakePR icons"
"Set the Decky theme to Rainbow. No, now set it back."
"What are my options for icons?"
"What are my options for widget types?"
"Is the bridge connected?"
"Show me the last 20 lines of bridge logs"
"What is in the approval queue right now?"
"Dump the current config for me"
"Reset the colors on slot 3 back to the theme default"
```

---

## 2. Architecture

### 2.1 Process model

The MCP server is a **separate Node.js process** that acts as a thin proxy between the MCP protocol and the existing Decky bridge REST API.

```
Claude.app
    │ MCP protocol (stdio)
    ▼
mcp/bin/decky-mcp           ← separate process, launched by Claude.app
    │ HTTP REST calls to localhost:9130
    │ Authorization: Bearer <token read from ~/.decky/bridge-token>
    ▼
bridge (localhost:9130)     ← existing bridge server, must be running
```

**Rationale for separate process:**
- MCP servers launched by Claude.app use stdio transport; they are spawned on demand.
- The bridge is long-running; keeping them separate avoids lifecycle coupling.
- The MCP server is stateless — all state lives in the bridge.

**Dependency:** The bridge must be running for MCP tools to work. Tools return a structured error with a clear message when the bridge is unreachable.

### 2.2 Directory structure

```
mcp/
  package.json              — dependencies: @modelcontextprotocol/sdk, node-fetch
  tsconfig.json             — TypeScript config (ESM, Node16)
  SECURITY.md               — security model documentation
  src/
    server.ts               — entry point; conditional tool registration based on readOnly
    bridge-client.ts        — typed HTTP client to bridge REST API
    tools/
      status.ts             — decky_probe_bridge, decky_get_status, decky_get_approval_queue
      config-read.ts        — decky_get_config, decky_list_themes, decky_list_icons,
                               decky_list_slot_types, decky_list_target_apps, decky_list_color_names
      config-write.ts       — decky_set_theme, decky_update_slot, decky_add_slot, decky_delete_slot,
                               decky_reorder_slots, decky_swap_slots, decky_update_global_settings,
                               decky_reload_config
      colors.ts             — decky_set_slot_colors, decky_set_global_colors, decky_reset_slot_colors,
                               decky_reset_all_colors
      debug.ts              — decky_get_debug_trace, decky_get_logs, decky_probe_bridge,
                               decky_get_debug_info, decky_get_pi_debug_status
  bin/
    decky-mcp.ts            — shebang wrapper for CLI execution
```

### 2.3 Claude.app configuration

MCP installation is **optional**. The default `hooks/install.sh` (and `hooks/install.js`) installs oversight hooks only. Pass `--with-mcp` to also register the MCP server:

```bash
# Oversight hooks only (default — recommended for most users):
node hooks/install.js

# Hooks + MCP server registration:
node hooks/install.js --with-mcp
```

The `--with-mcp` flag runs `claude mcp add decky --command npx -- -y @decky/mcp`. If `claude` is not in PATH, the installer prints the manual command and skips gracefully.

To add MCP later without re-running the full installer:
```bash
claude mcp add decky --command npx -- -y @decky/mcp
```

**Uninstall:** Both `hooks/uninstall.sh` and `hooks/uninstall.js` run `claude mcp remove decky` automatically (suppressing errors if MCP was never registered).

**Read-only mode:** By default the bridge runs with `readOnly: true`, which means the MCP server skips registration of all config-write tools at startup. Config reads, status, debug, and probe tools are always available. To enable write tools:

```bash
DECKY_READONLY=0 npm start      # bridge side
# or set readOnly: false in ~/.decky/config.json
```

The server discovers the bridge token by reading `~/.decky/bridge-token` at startup (re-read on every request for token-rotation compatibility). The bridge URL defaults to `http://127.0.0.1:9130` and can be overridden by `DECKY_BRIDGE_URL`.

---

## 3. Named Vocabularies

The MCP tools expose named vocabularies so Claude can translate natural language to API values.

### 3.1 Named colors

The following names map to CSS hex values. All color fields also accept any valid CSS color string (`#rrggbb`, `rgb(...)`, CSS named colors).

| Name     | Hex       | Name     | Hex       |
| -------- | --------- | -------- | --------- |
| `red`    | `#ef4444` | `green`  | `#22c55e` |
| `blue`   | `#3b82f6` | `yellow` | `#eab308` |
| `orange` | `#f97316` | `purple` | `#a855f7` |
| `pink`   | `#ec4899` | `white`  | `#ffffff` |
| `black`  | `#000000` | `gray`   | `#6b7280` |
| `amber`  | `#f59e0b` | `cyan`   | `#06b6d4` |
| `teal`   | `#14b8a6` | `lime`   | `#84cc16` |
| `indigo` | `#6366f1` | `rose`   | `#f43f5e` |

The `decky_list_color_names` tool returns this table.

### 3.2 Named icons

The icon field in a slot definition is free-form text rendered on the button face. The following named icons map to emoji or Unicode symbols. Users can also specify any emoji or text directly.

| Name | Symbol | Name | Symbol |
|------|--------|------|--------|
| `checkmark` | ✓ | `cross` | ✗ |
| `stop` | ⏹ | `stopsign` | 🛑 |
| `restart` | 🔄 | `microphone` | 🎤 |
| `chart` | 📊 | `warning` | ⚠️ |
| `rocket` | 🚀 | `sparkles` | ✨ |
| `fire` | 🔥 | `brain` | 🧠 |
| `gear` | ⚙️ | `clock` | ⏱ |
| `play` | ▶ | `pause` | ⏸ |
| `fast-forward` | ⏩ | `rewind` | ⏪ |
| `pencil` | ✏️ | `trash` | 🗑️ |
| `lock` | 🔒 | `key` | 🔑 |
| `shield` | 🛡️ | `bug` | 🐛 |
| `git` | 🌿 | `pr` | 🔀 |
| `commit` | 💾 | `cloud` | ☁️ |

The `decky_list_icons` tool returns this table. Icon names are case-insensitive.

Note: The built-in slot types (approve, deny, cancel, restart, widget) render SVG icons programmatically from `layouts.ts`. Those SVGs cannot be changed via config — only the text `icon` field on `macro` type slots is user-configurable. Setting `icon` or `text` on a non-macro slot returns a clear error.

### 3.3 Themes

| Name | Description |
|------|-------------|
| `light` | Light gray background, dark text |
| `dark` | Dark background, light text |
| `dracula` | Purple/pink dark theme |
| `monokai` | Green/orange on dark |
| `solarized-dark` | Solarized dark palette |
| `solarized-light` | Solarized light palette |
| `nord` | Cool blue-gray Nordic palette |
| `github-dark` | GitHub dark mode colors |
| `candy-cane` | Red/white festive theme |
| `gradient-blue` | Blue gradient backgrounds |
| `wormhole` | Dark with electric accents |
| `rainbow` | Deterministic per-slot hue rotation |
| `random` | Random color per slot on each render |

### 3.4 Slot types

| Type | Description | Configurable fields |
|------|-------------|---------------------|
| `macro` | Text injection + optional auto-submit | label, text, icon, fontSize, colors, targetApp, submit |
| `approve` | Approve queued tool | label, colors |
| `deny` | Deny queued tool | label, colors |
| `cancel` | Cancel/stop execution | label, colors |
| `restart` | Force return to idle | label, colors |
| `approveOnceInClaude` | Approve and activate Claude.app | label, colors |
| `startDictationForClaude` | Start macOS dictation | label, colors |
| `widget` | Status display widget | label, colors, widget.kind, widget.refreshMode, widget.intervalMinutes |

### 3.5 Widget kinds

| Kind | Description |
|------|-------------|
| `bridge-status` | Shows bridge connection status (green/red dot) |

### 3.6 Target apps

| Name | App |
|------|-----|
| `claude` | Claude.app |
| `codex` | Codex CLI |
| `chatgpt` | ChatGPT desktop |
| `cursor` | Cursor editor |
| `windsurf` | Windsurf editor |

---

## 4. Tool Catalog

All tools follow MCP JSON schema conventions. Every tool returns either a structured result or an `error` field with a human-readable message.

### 4.1 Status & state tools

#### `decky_get_status`
Returns the current bridge state snapshot.

**Input:** none

**Output:**
```json
{
  "connected": true,
  "state": "awaiting-approval",
  "tool": "Bash",
  "pendingApprovals": 2,
  "rateLimit": { "percentUsed": 42, "resetAt": "2026-03-11T18:00:00Z" }
}
```

#### `decky_get_approval_queue`
Returns the full approval queue with tool names and flow types.

**Input:** none

**Output:**
```json
{
  "queue": [
    { "id": "abc123", "tool": "Bash", "flow": "gate", "age_s": 4 },
    { "id": "def456", "tool": "Write", "flow": "mirror", "age_s": 1 }
  ],
  "count": 2
}
```

#### `decky_get_rate_limit`
Returns current 5-hour token usage.

**Input:** none

**Output:**
```json
{
  "totalTokens5h": 42000,
  "percentUsed": 42,
  "maxTokens5h": 100000,
  "resetAt": "2026-03-11T18:00:00Z"
}
```

---

### 4.2 Config read tools

#### `decky_get_config`
Returns the full current configuration.

**Input:** none

**Output:** Full `DeckyConfig` object as JSON (macros array, theme, global settings).

#### `decky_list_themes`
Returns all available theme names and descriptions.

**Input:** none

**Output:** Array of `{ name, description }` — the table in §3.3.

#### `decky_list_icons`
Returns the named icon vocabulary.

**Input:** none

**Output:** Array of `{ name, symbol, description }` — the table in §3.2.

#### `decky_list_slot_types`
Returns all available slot types with their configurable fields.

**Input:** none

**Output:** Array of `{ type, description, configurableFields[] }` — the table in §3.4.

#### `decky_list_target_apps`
Returns target app names.

**Input:** none

**Output:** Array of `{ name, description }`.

#### `decky_list_color_names`
Returns the named color palette.

**Input:** none

**Output:** Array of `{ name, hex }` — the table in §3.1.

> **Removed:** `decky_get_config_backups` and `decky_restore_config_backup` were removed per security review (see `mcp-security-analysis.md`). Automatic backup rotation is preserved; users can restore backups via `scripts/recover-config.mjs` or manual file copy.

---

### 4.3 Config write tools

> **Note:** These tools are only registered when the bridge is not in read-only mode (see §2.3).

#### `decky_set_theme`

**Input:**
```json
{
  "theme": "rainbow",
  "applyMode": "keep"
}
```
- `theme`: one of the theme names in §3.3
- `applyMode`: `"keep"` (default) | `"clear-page"` | `"clear-all"`

**Output:** `{ "success": true, "theme": "rainbow" }`

#### `decky_update_slot`
Update an existing slot by 0-based index (or `row`/`col`).

**Input:**
```json
{
  "index": 2,
  "label": "Proceed",
  "type": "macro",
  "text": "/approve",
  "icon": "checkmark",
  "fontSize": 11,
  "targetApp": "claude",
  "submit": false,
  "colors": {
    "bg": "green",
    "text": "white",
    "icon": "white"
  }
}
```

All fields except `index` (or `row`/`col`) are optional; omitted fields are unchanged.

Named icon values from §3.2 are resolved to their symbols before saving. Named colors from §3.1 are resolved to hex.

**Output:** `{ "success": true, "slot": <updated MacroDef> }`

#### `decky_add_slot`
Append a new slot. Uses the same field schema as `decky_update_slot` minus `index`.

**Input:** Same as `decky_update_slot` without `index`. `type` defaults to `"macro"`.

**Output:** `{ "success": true, "index": 8, "slot": <new MacroDef> }`

Note: The bridge config has no hard-coded slot maximum; the tool warns when slot count exceeds 15 (most common deck model).

#### `decky_delete_slot`
Delete a slot by index.

**Input:** `{ "index": 3 }`

**Output:** `{ "success": true, "remainingCount": 7 }`

#### `decky_reorder_slots`
Reorder slots by specifying the new index order.

**Input:**
```json
{
  "newOrder": [0, 2, 1, 3, 4, 5]
}
```
`newOrder` is a permutation of `[0 .. n-1]` where `n` is the current slot count.

**Output:** `{ "success": true, "slots": <reordered MacroDef[]> }`

#### `decky_swap_slots`
Convenience wrapper: swap two slots by index (common natural-language pattern: "switch the Push and MakePR icons").

**Input:** `{ "indexA": 1, "indexB": 4 }`

**Output:** `{ "success": true }`

#### `decky_update_global_settings`
Update global settings without touching macros.

**Input (all optional):**
```json
{
  "approvalTimeout": 30,
  "defaultTargetApp": "claude",
  "showTargetBadge": true,
  "popUpApp": true,
  "enableApproveOnce": true,
  "enableDictation": false
}
```

**Output:** `{ "success": true, "settings": <updated global fields> }`

#### `decky_reload_config`
Reload the config from disk (pick up manual edits to `~/.decky/config.json`).

**Input:** none

**Output:** `{ "success": true }`

---

### 4.4 Color management tools

> **Note:** These tools are only registered when the bridge is not in read-only mode (see §2.3).

#### `decky_set_slot_colors`
Set per-slot color overrides.

**Input:**
```json
{
  "index": 2,
  "bg": "green",
  "text": "white",
  "icon": "white"
}
```
All color fields accept named colors (§3.1) or CSS color strings.

**Output:** `{ "success": true }`

#### `decky_set_global_colors`
Set page-level (default) color overrides that apply to all slots without per-slot overrides.

**Input:**
```json
{
  "bg": "#1a1a2e",
  "text": "#e0e0e0",
  "icon": "#ffffff"
}
```

**Output:** `{ "success": true }`

#### `decky_reset_slot_colors`
Remove color overrides from one slot, reverting to theme/page defaults.

**Input:** `{ "index": 2 }`

**Output:** `{ "success": true }`

#### `decky_reset_all_colors`
Remove all color overrides (per-slot and global).

**Input:** none

**Output:** `{ "success": true }`

---

### 4.5 Debug & introspection tools

These give Claude visibility into bridge internals.

#### `decky_probe_bridge`
Ping the bridge and return connectivity status, version, and uptime.

**Input:** none

**Output:**
```json
{
  "reachable": true,
  "url": "http://127.0.0.1:9130",
  "state": "idle",
  "uptimeSeconds": 3720
}
```
Returns `{ "reachable": false, "error": "ECONNREFUSED" }` when bridge is down.

#### `decky_get_debug_trace`
Return the recent approval trace history (requires `DECKY_DEBUG=1` on the bridge).

**Input:** `{ "limit": 20 }` (default 20, max 100)

**Output:** The `traces` array from `/debug/approval-trace` with a human-readable summary.

**Error if debug mode not enabled:** Returns a helpful message explaining how to enable it.

#### `decky_get_debug_info`
Return a comprehensive debug snapshot: state, config summary, queue, rate limit, and last trace entry.

**Input:** none

**Output:** Merged object of status + config summary + queue + rate limit.

#### `decky_get_logs`
Return recent bridge log output.

**Input:** `{ "lines": 50, "level": "all" }` — `level` is `"all"` | `"error"` | `"warn"`

**Output:** `{ "lines": ["[INFO] bridge started", ...] }`

The bridge maintains a 500-entry in-memory circular log buffer, exposed via `GET /logs`.

#### `decky_get_pi_debug_status`
Return a bridge-side config snapshot (macro count, theme, last-update timestamp, connection status).

**Output:**
```json
{
  "bridgeConnected": true,
  "bridgeUrl": "http://127.0.0.1:9130",
  "macroCount": 8,
  "theme": "nord",
  "buildInfo": "0.1.0.0",
  "lastConfigUpdate": "2026-03-11T10:00:00Z"
}
```

---

## 5. Slot assignment constraints

### 5.1 Configuring empty Stream Deck slots as Decky slots

The Elgato Stream Deck SDK does **not** support programmatically assigning an action to an empty slot via the plugin API. This means:

- MCP can create/update/delete slots in the bridge **config** (the `macros` array).
- A user must manually drag a Decky Slot action onto a physical button in the Stream Deck app first.
- Once the Decky Slot action is present, the MCP can configure its behavior.

`decky_add_slot` returns a note if the new slot index has no corresponding physical button. `decky_get_status` includes the detected deck model and button count.

### 5.2 Slot heartbeat with 2D positions

The plugin emits a `slotHeartbeat` Socket.io event to the bridge on connect and whenever its set of active slots changes. The bridge stores this and includes a `deck` field in `GET /status`:

```json
{
  "deck": {
    "deviceId": "ABC123",
    "model": "Stream Deck MK.2",
    "rows": 3,
    "cols": 5,
    "buttonCount": 15,
    "activeSlots": [
      { "index": 0, "row": 0, "col": 0 },
      { "index": 2, "row": 0, "col": 2 }
    ]
  }
}
```

`decky_update_slot`, `decky_set_slot_colors`, `decky_reset_slot_colors`, and `decky_delete_slot` accept `{ "row": N, "col": M }` as an alternative to `{ "index": N }`.

---

## 6. Security design

### 6.1 Threat model

| Threat | Mitigation |
|--------|-----------|
| Another local process reads the bridge token | Token file is `~/.decky/bridge-token`, mode `0o600` (owner-read only). No new exposure. |
| MCP server exposes bridge to network | MCP server uses stdio transport (no network listener). Bridge is bound to `127.0.0.1`. No new exposure. |
| Config-write tools allow macro poisoning / dead drop | Default `readOnly: true` — write tools not registered at startup. Override is explicit user opt-in. |
| Config backup restore overwrites state unexpectedly | **Eliminated** — `decky_restore_config_backup` and `decky_get_config_backups` removed per security review. |
| MCP tool leaks sensitive data from config | Config contains macro text (user-defined), no secrets or credentials. Bridge token is not returned by any MCP tool. |
| Prompt injection via macro labels/text returned to Claude | Tools return config content as structured JSON. Tool descriptions note that returned config content is user data, not instructions. |
| Log endpoint exposes sensitive output | Bridge logs are redacted (`redactActionForLog`). The `/logs` endpoint applies the same redaction. |

### 6.2 Best practices applied

- **No new network listener.** MCP server is stdio-only.
- **Token from file, not env.** Token is read from `~/.decky/bridge-token` (`0o600`). Not passed as CLI argument or env var.
- **No shell exec.** MCP server calls bridge REST endpoints only.
- **Input validation.** All MCP tool inputs are validated against JSON schema before sending to the bridge.
- **Principle of least privilege.** The MCP server has the same access as the bridge token holder.
- **Token rotation compatible.** The MCP server re-reads `~/.decky/bridge-token` on each request.
- **Read-only by default.** Write tools are not registered unless the user explicitly enables write mode.

See `mcp-security-analysis.md` for the full threat model and attack vector analysis.

---

## 7. Open issues

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| ISSUE-1 | Low | Token file path and `DECKY_BRIDGE_URL` must be documented in `mcp/README.md` | **Open** — `mcp/README.md` not yet written; `mcp/SECURITY.md` covers security model |

All other issues from the original draft are resolved:
- ISSUE-3: icon/text validation on non-macro slots — implemented
- ISSUE-4: slot count warning at 15+ — implemented
- ISSUE-5: log buffer + GET /logs endpoint — implemented
- ISSUE-7: SDK slot assignment constraint — documented in `decky_add_slot` response and §5.1
- ISSUE-8: 2D slot positions via slotHeartbeat — implemented

---

## 8. Scope explicitly out of this work

- Multiple deck / per-deck configuration routing
- Soft surface / web companion
- hidapi direct control
- Gemini CLI / Amp CLI provider support
- Stream Deck profile management (not accessible via Elgato SDK)
