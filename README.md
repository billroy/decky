# Decky

StreamDeck MK.2 controller for Claude Code on macOS. Approve tool use, deny, cancel, run utility actions, and send text macros with physical buttons instead of clicking through the GUI.

## Install

Requires macOS 13+, Node.js 20+, Elgato StreamDeck MK.2 with Stream Deck app 6.6+, and Claude Code.

```bash
git clone https://github.com/billroy/decky.git
cd decky
./install.sh
```

This installs dependencies, builds the plugin, copies hook scripts to `~/.decky/hooks/`, registers them in `~/.claude/settings.json`, and links the plugin to Stream Deck.

Restart the Stream Deck app after install. Then add **Decky Slot** buttons to your deck (place 6 for the full layout).

Configure macros, target routing, theme, and colors from the Property Inspector in the Stream Deck app.

## Start

```bash
./start.sh
```

Starts the bridge server on `http://localhost:9130`. Keep it running while using Claude Code.

## How it works

Decky has two parts: a **bridge server** and a **StreamDeck plugin**.

**Bridge server** (`bridge/`) receives lifecycle hook events from Claude Code (`PreToolUse`, `PostToolUse`, `Stop`, etc.), tracks state, and broadcasts changes over Socket.io.

**StreamDeck plugin** (`plugin/`) connects to the bridge and dynamically updates button icons and behavior based on the current state.

### States

| State | Deck shows | Available actions |
|---|---|---|
| **idle** | Macro buttons/widgets (up to 36) | Press to inject text into selected app or refresh widget |
| **thinking** | Thinking indicator + Stop | Stop |
| **awaiting-approval** | Approve, Deny, Cancel, tool name | Approve / Deny / Cancel |
| **tool-executing** | Stop + tool name | Stop |
| **stopped** | Restart | Restart |

### Approval workflow

When Claude Code wants to run a tool, the `PreToolUse` hook fires and the bridge enters the `awaiting-approval` state. The hook script blocks, waiting for a decision. Press **Approve** on the deck and the tool runs. Press **Deny** to skip it or **Cancel** to stop the session.

### Macros

In the idle state, the deck shows up to 36 configurable macro slots. Each slot can be a **Command** macro or a **Widget**.

Command macro behavior:
- Press one and the text is typed into the selected target app via the clipboard (`pbcopy` + Cmd+V).
- Optional per-macro `submit` controls whether Return is pressed automatically after paste (default `true`).
- Supported targets are Claude, Codex, ChatGPT, Cursor, and Windsurf.

Widget behavior:
- Current built-in widget type is `bridge-status`.
- Refresh mode can be `onClick` or `interval` (`intervalMinutes` 1..60).

Edit macros in the Stream Deck app by selecting a Decky Slot button and using the Property Inspector.

## Configuration

Config lives at `~/.decky/config.json` (created with defaults on first run):

```json
{
  "macros": [
    { "label": "Continue", "text": "Continue", "targetApp": "claude", "submit": true },
    { "label": "Bridge", "text": "", "type": "widget", "widget": { "kind": "bridge-status", "refreshMode": "interval", "intervalMinutes": 5 } }
  ],
  "approvalTimeout": 30,
  "defaultTargetApp": "claude",
  "showTargetBadge": false,
  "enableApproveOnce": true,
  "enableDictation": true
}
```

- **macros**: Up to 36 entries. `label` shows on the button, `text` is sent to the selected app.
- **macro.targetApp**: Optional per-macro target override (`claude`, `codex`, `chatgpt`, `cursor`, `windsurf`).
- **macro.submit**: Optional per-macro boolean. When `false`, macro text is pasted only (no Return key).
- **macro.type**: Optional macro type (`macro` or `widget`).
- **macro.widget**: Required when `type` is `widget`. Currently supports `{ "kind": "bridge-status" }`.
- **approvalTimeout**: Seconds the hook waits for a button press before auto-blocking (default 30).
- **defaultTargetApp**: Global default target used when a macro has no explicit `targetApp`.
- **showTargetBadge**: Toggle compact 3-letter target badges on macro icons (for example `CLD`, `CDX`).
- **enableApproveOnce**: Enables/disables the dedicated `Approve Once (Claude)` action.
- **enableDictation**: Enables/disables the dedicated `Talk to Claude` action.

### Property Inspector controls

- **Theme**: Select one of the built-in themes.
- **Theme apply**: Choose whether theme changes keep overrides, clear page defaults, or clear all overrides.
- **Approval timeout**: Seconds before a tool-approval request is auto-blocked.
- **Target app (selected slot)**: Per-macro provider override.
- **Target badge**: Show/hide compact provider badge on icons.
- **Approve once action**: Enable/disable dedicated `Approve Once (Claude)` key behavior.
- **Talk to Claude action**: Enable/disable dedicated dictation key behavior.
- **Page default colors**: Background/text/icon defaults for all macros.
- **Macro colors**: Per-macro background/text/icon overrides.
- **Macro Type**: Switch each slot between `Command` and `Widget`.
- **Command Submit**: For command macros, choose paste-only vs paste-and-submit.
- **Widget settings**: For widgets, set refresh mode and interval.

Unconfigured slots are intentionally no-op.

## Development

```bash
# Bridge (auto-restarts on changes)
cd bridge && npm run dev

# Plugin (watch mode for rollup)
cd plugin && npm run watch

# Tests
cd bridge && npm test
cd plugin && npm test
```

## Project structure

```
install.sh             One-step install
start.sh               Start the bridge

bridge/                Bridge server (Express + Socket.io)
  src/app.ts             App factory
  src/server.ts          Entry point (port 9130)
  src/state-machine.ts   State machine (5 states)
  src/approval-gate.ts   File-based approval signaling
  src/config.ts          Config loader (~/.decky/config.json)
  src/macro-exec.ts      AppleScript text injection

plugin/                StreamDeck plugin
  src/plugin.ts          Entry point
  src/bridge-client.ts   Socket.io client
  src/layouts.ts         State-driven button layouts
  src/actions/           Action handlers (slot, status, approve, approve-once, deny, cancel, dictation)
  com.decky.controller.sdPlugin/
    manifest.json        Plugin manifest
    ui/                  Property Inspector

hooks/                 Claude Code hook scripts
  pre-tool-use.sh        Blocking hook (polls approval gate)
  post-tool-use.sh       State update
  stop.sh                State update
  notification.sh        State update
```

## REST API

The bridge exposes these endpoints:

- `POST /hook` — receives Claude Code hook events
- `GET /status` — current state snapshot
- `GET /config` — current config
- `PUT /config` — save updated config
- `POST /config/reload` — reload config from disk

## License

MIT
