# Decky — Initial Analysis

*StreamDeck MK.2 controller for Claude.app on macOS*

---

## 1. Claude.app / Claude Code State Taxonomy

Claude Code exposes five lifecycle hooks that fire at well-defined points. These, combined with the observable behavior of Claude.app, yield the following complete state taxonomy.

### Hook-derived states

| State | Triggering Hook | Description |
|---|---|---|
| `idle` | `Stop` or `SubagentStop` | Claude has finished responding; waiting for user input |
| `thinking` | *(between user send and first hook)* | Claude is processing — no tool use yet |
| `awaiting-tool-approval` | `PreToolUse` | Claude wants to run a tool; user must approve or deny |
| `tool-executing` | *(between PreToolUse approval and PostToolUse)* | An approved tool is running |
| `tool-complete` | `PostToolUse` | Tool finished; Claude resuming |
| `notification` | `Notification` | Claude is surfacing a message that doesn't require approval |
| `subagent-running` | *(between SubagentStop events)* | A sub-task/subagent is active |
| `stopped` | `Stop` with error or interrupt | Session ended, possibly due to error or user cancel |

### UI-layer states (Claude.app-specific)

These are observable via Claude.app's approval dialogs and map on top of the hook states:

| UI State | Maps to Hook State | StreamDeck Action Needed |
|---|---|---|
| Approval dialog — tool use | `awaiting-tool-approval` | Show Approve / Deny / Cancel layout |
| Plan approval ("Make it so") | `awaiting-tool-approval` (plan tool) | Show Accept Plan / Reject layout |
| Streaming response | `thinking` | Show Stop button |
| Idle prompt | `idle` | Show macro/quick-action layout |
| Tool running | `tool-executing` | Show Stop button |
| Error / stopped | `stopped` | Show Restart Session button |

### State machine diagram

```
[idle] ──user sends──> [thinking]
[thinking] ──tool needed──> [awaiting-tool-approval]
[thinking] ──no tools──> [idle]  (via Stop hook)
[awaiting-tool-approval] ──approved──> [tool-executing]
[awaiting-tool-approval] ──denied──> [thinking]
[tool-executing] ──complete──> [tool-complete] ──> [thinking]
[thinking] ──Stop hook──> [idle]
[any] ──interrupt/error──> [stopped]
[stopped] ──restart──> [idle]
```

---

## 2. Feature Set

Informed by AgentDeck, TerminalDeck, and first principles for the Claude.app MK.2 use case.

### P0 — Core (must have for any useful prototype)

**Approval workflow**
- Green "Approve" button when tool-approval dialog is active
- Red "Deny" button
- Yellow "Cancel / Stop" button (sends interrupt at any time)
- Buttons are hidden / replaced in other states — no accidental presses

**State-driven dynamic layouts**
- Layout changes automatically as Claude transitions states
- Visual feedback: button icon + label update per state
- "Thinking" layout: animated spinner + Stop button
- "Idle" layout: macro grid + optional prompt button

**Stop / interrupt**
- Always-present emergency stop button (possibly a fixed corner button)
- Sends Ctrl-C or Claude Code interrupt signal via the bridge

### P1 — Quick wins (high value, low complexity)

**Text macro buttons**
- Configurable one-tap phrases: "Make it so", "Continue", "Yes", "No", "Stop and think", "Summarize what you've done"
- Injected into Claude.app via AppleScript keystroke injection or simulated input
- Macros defined in JSON config; hot-reloadable

**Session management**
- "New session" button — opens a fresh Claude.app session
- "Restart bridge" button — restarts the Node.js bridge without touching Claude

**Status indicator button**
- Non-interactive button showing connection health: bridge up/down, hook firing confirmation
- Color-coded: green = healthy, amber = no recent hook events, red = bridge unreachable

### P2 — Richer UX (useful but deferrable)

**Token / usage display**
- Inspired by AgentDeck's water-gauge: show approximate token consumption on a button face
- Source: parse Claude Code's `~/.claude/` session logs or hook `PostToolUse` metadata

**Multiple profiles**
- Different button layouts for different workflows (e.g., "Code Review", "Implementation", "Planning")
- Profile selector button cycles through saved profiles
- Profiles stored as JSON in `~/.decky/profiles/`

**Voice input (push-to-talk)**
- Inspired by AgentDeck: hold a button to record, release to transcribe and send to Claude
- Uses whisper.cpp locally (Metal-accelerated on Apple Silicon) or macOS built-in dictation
- Deferrable — complex dependency chain

**Property Inspector UI (Vue.js)**
- StreamDeck's built-in Property Inspector panel (rendered as HTML inside StreamDeck software)
- Vue.js component for editing button labels, macro text, profile assignment
- No separate browser app needed; everything lives in the StreamDeck sidebar

### Persistence requirements (imputed from AgentDeck + TerminalDeck + this app)

| Data | Format | Location |
|---|---|---|
| App config (port, paths, Claude executable) | JSON | `~/.decky/config.json` |
| Button profiles / layouts | JSON files | `~/.decky/profiles/` |
| Macro definitions | JSON (embedded in profile) | within profile JSON |
| Auth token (if LAN expansion later) | plain text | `~/.decky/auth-token` |
| Hook event log (debug/optional) | SQLite | `~/.decky/events.db` |
| Runtime state | In-memory only | Bridge process memory |

File-based JSON is sufficient for the prototype. SQLite is recommended only for the optional event log (if debugging hook delivery becomes necessary); not required initially.

---

## 3. Architecture Recommendation

### Recommended: Node.js + Express + Socket.io bridge

**Rejected options:**

- **Electron app** — adds significant complexity and a GUI framework overhead for what is fundamentally a background daemon. No user-facing window is needed in normal operation.
- **Python + Flask** — would require Python runtime, separate dependency chain from the TypeScript StreamDeck SDK, and lacks strong async event handling for socket.io. The StreamDeck SDK is Node.js-native; keeping everything in one runtime is simpler.
- **Tauri/Rust (as in TerminalDeck)** — powerful but extreme complexity for a prototype; Rust expertise not assumed.

**Chosen: Node.js + Express + Socket.io** is the natural fit because the StreamDeck SDK is already TypeScript/Node.js, the bridge and plugin can share types and utilities, socket.io is first-class, and the entire stack is one `npm install` away.

### Component diagram

```
┌─────────────────────────────────────────────────────┐
│  macOS Host                                          │
│                                                      │
│  ┌──────────────┐    hooks     ┌──────────────────┐ │
│  │  Claude.app  │─────────────>│  Hook Script     │ │
│  │  (Claude     │              │  (bash/node)     │ │
│  │   Code)      │              └────────┬─────────┘ │
│  └──────────────┘                       │ HTTP POST  │
│                                         ▼            │
│                              ┌──────────────────┐   │
│                              │  Decky            │   │
│                              │  Bridge Server    │   │
│                              │  (Node.js +       │   │
│                              │   Express +       │   │
│                              │   Socket.io)      │   │
│                              │  :9130            │   │
│                              └────────┬──────────┘   │
│                                       │ socket.io     │
│                                       ▼              │
│                              ┌──────────────────┐   │
│                              │  StreamDeck       │   │
│                              │  Plugin           │   │
│                              │  (TypeScript +    │   │
│                              │  @elgato/stream   │   │
│                              │   deck SDK)       │   │
│                              └────────┬──────────┘   │
│                                       │ HID           │
└───────────────────────────────────────┼─────────────┘
                                        ▼
                              ┌──────────────────┐
                              │  StreamDeck MK.2 │
                              │  (hardware)      │
                              └──────────────────┘
```

### Data flow — approval example

1. Claude.app calls a tool (e.g., `Bash`)
2. `PreToolUse` hook fires → bash script POSTs `{"event":"PreToolUse","tool":"Bash","input":"..."}` to bridge at `localhost:9130/hook`
3. Bridge updates state machine → `awaiting-tool-approval`
4. Bridge emits `stateChange` event via socket.io to plugin
5. Plugin receives event → switches to approval layout (Approve / Deny / Cancel buttons)
6. User presses Approve on StreamDeck MK.2
7. Plugin emits `action` event → `{"action":"approve"}` to bridge
8. Bridge writes `"y\n"` to Claude Code's approval mechanism (via AppleScript or file signal)
9. Bridge transitions state → `tool-executing`
10. Plugin switches layout to "running" (Stop button only)

### Hook configuration (written to `~/.claude/settings.local.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "~/.decky/hooks/pre-tool-use.sh" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "~/.decky/hooks/post-tool-use.sh" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "~/.decky/hooks/notification.sh" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "~/.decky/hooks/stop.sh" }] }
    ]
  }
}
```

Each hook script reads the JSON payload from stdin and POSTs it to the bridge.

### Approval signal delivery

The hook intercepts state but Claude Code still waits for a response. Two options exist; both should be prototyped in Phase 3:

- **Option A — Hook exit code:** `PreToolUse` hooks can return a non-zero exit code to block tool execution. The hook script can *block* (poll a local file/socket) until the StreamDeck button press resolves the gate, then exit 0 (approve) or non-zero (deny). This is the cleanest mechanism.
- **Option B — AppleScript keystroke injection:** Bridge uses AppleScript to send `y` or `n` keypresses to the active Claude.app window. Fragile if Claude.app loses focus, but doesn't require blocking hook scripts.

**Recommendation:** Start with Option A (blocking hook + exit code) since it's architecturally clean and doesn't depend on window focus.

---

## 4. Implementation Phases

Each phase is scoped for < 20 minutes of AI coding time and produces a runnable, independently testable increment. Phases are designed to survive session restarts — each builds on the previous without requiring re-explanation of prior work.

### Phase 1 — Bridge server skeleton (~15 min)

**Goal:** A running Node.js server that receives hook POSTs and logs state transitions.

Deliverables:
- `bridge/` — Node.js + Express + Socket.io project (`package.json`, `tsconfig.json`, `src/server.ts`)
- `POST /hook` endpoint accepts `{event, tool, input}` JSON
- In-memory state machine with 5 states: `idle`, `thinking`, `awaiting-approval`, `tool-executing`, `stopped`
- Socket.io server on port 9130 emits `stateChange` events
- Console log shows state transitions
- `GET /status` returns current state as JSON

**Test:** `curl -X POST localhost:9130/hook -H 'Content-Type: application/json' -d '{"event":"PreToolUse","tool":"Bash"}'` → console shows state change to `awaiting-approval`

### Phase 2 — StreamDeck plugin scaffold (~15 min)

**Goal:** A StreamDeck plugin that connects to the bridge and shows connection status on one button.

Deliverables:
- `plugin/` — TypeScript StreamDeck plugin (`@elgato/streamdeck` SDK scaffold)
- Single action type: `com.decky.status`
- Connects to bridge socket.io on startup
- Button shows green circle on connect, red on disconnect
- Receives `stateChange` events and logs them to plugin console

**Test:** Start bridge + install plugin → StreamDeck button turns green. Kill bridge → button turns red.

### Phase 3 — Approval workflow end-to-end (~20 min)

**Goal:** StreamDeck buttons approve or deny a Claude tool use.

Deliverables:
- Hook scripts: `~/.decky/hooks/pre-tool-use.sh` (blocking — polls `~/.decky/approval-gate` file, then exits with 0/1)
- Bridge writes approval result to `~/.decky/approval-gate` when action event received
- Plugin approval layout: 3 buttons — Approve (green ✓), Deny (red ✗), Cancel (yellow ⏹)
- Layout activates automatically when `stateChange` → `awaiting-approval`
- Button press emits `action: approve | deny | cancel` to bridge
- Bridge resolves gate file and transitions state

**Test:** Start a `claude` session that tries to run a bash command → StreamDeck switches to approval layout → press Approve → Claude proceeds.

### Phase 4 — State-driven dynamic layouts (~15 min)

**Goal:** All states have appropriate layouts; layouts switch automatically.

Deliverables:
- Layout definitions (JSON) for each state: `idle`, `thinking`, `awaiting-approval`, `tool-executing`, `stopped`
- Plugin layout manager reads state events and swaps button configurations
- Idle layout: 6 macro stubs (labelled "Macro 1–6" initially)
- Thinking layout: pulsing indicator + Stop button
- Tool-executing layout: tool name on display + Stop button
- Stopped layout: Restart button

**Test:** Walk through a full Claude session — confirm each layout appears at the right moment.

### Phase 5 — Text macro buttons (~15 min)

**Goal:** One-tap text injection into Claude.app.

Deliverables:
- `~/.decky/config.json` with `macros` array: `[{label, text, icon}]`
- Bridge `/config` endpoint serves config JSON to plugin on connect
- Plugin renders macro buttons in idle layout from config
- Button press emits `action: macro, text: "..."` to bridge
- Bridge executes AppleScript: `tell application "Claude" to activate` then `keystroke "..."` to inject text
- Hot-reload: `POST /config/reload` re-reads config file and pushes update to plugin

**Test:** Configure "Make it so" macro → press button → text appears in Claude.app input.

### Phase 6 — Config file + Property Inspector (Vue.js) (~20 min)

**Goal:** User can edit button labels and macros without touching JSON directly.

Deliverables:
- StreamDeck Property Inspector HTML file for macro action: `property-inspector/index.html`
- Vue.js (CDN-loaded) renders a simple form: label field, text field, icon selector
- Property Inspector reads/writes to bridge via REST (`GET/PUT /config`)
- Changes persisted to `~/.decky/config.json`
- Hot-reload triggered automatically on save

**Test:** Open StreamDeck Property Inspector for a macro button → edit label → button label updates on deck.

---

## 5. Open Issues

### Issue 1 — Blocking hook approval timing
**Problem:** Option A (blocking hook script) requires the hook to remain running while waiting for a StreamDeck button press. If the bridge is not running when the hook fires, Claude will hang indefinitely.
**Recommendation:** Hook script should time out after a configurable interval (default 30 seconds) and approve by default (or deny by default — user preference). Add a timeout config key to `~/.decky/config.json`. Bridge startup should be made part of macOS login items.

### Issue 2 — AppleScript text injection reliability
**Problem:** Keystroke injection via AppleScript depends on Claude.app being frontmost, or requires `System Events` accessibility permissions. macOS may prompt for permission on first run.
**Recommendation:** Bridge should request accessibility permissions at first launch with a clear explanation. As a fallback, write macro text to the macOS pasteboard and use Cmd+V paste instead of keystroke-by-keystroke.

### Issue 3 — Claude Code hook schema stability
**Problem:** Claude Code's hook payload schema (`PreToolUse`, etc.) is not yet formally versioned and could change between Claude Code releases.
**Recommendation:** Write a thin schema-validation layer in the bridge (`/hook` endpoint) that validates and normalizes payloads. If an unknown schema is received, log it and emit a `notification` state rather than crashing.

### Issue 4 — StreamDeck plugin distribution / installation
**Problem:** Installing a StreamDeck plugin requires either publishing to the Elgato marketplace or using `streamdeck link` (developer mode) during development.
**Recommendation:** For personal use, `streamdeck link` is sufficient. Document the setup script. If sharing with others later, a GitHub release with a `.streamDeckPlugin` bundle is straightforward.

### Issue 5 — "Make it so" vs standard tool approval
**Problem:** The "Make it so" flow (approving an entire implementation plan) uses a different interaction pattern than individual tool approvals. It is not clear whether this fires a `PreToolUse` hook or requires detecting a different UI state in Claude.app.
**Recommendation:** During Phase 3 testing, explicitly test the "enter plan execution mode" flow to confirm which hook fires (or if a different mechanism is needed). May require the AppleScript injection path as a fallback for plan-level approvals.

---

*Analysis complete. Ready to begin Phase 1 implementation on instruction.*
