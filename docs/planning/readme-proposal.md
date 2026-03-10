# Decky

Control your AI coding agent from a Stream Deck. Approve, deny, and cancel tool calls with physical buttons. Send prompts with one tap. See what your agent is doing at a glance.

Decky works with Claude Code, and can send macros to Claude, Codex, ChatGPT, Cursor, and Windsurf.

## How Decky Works

Decky sits between your AI coding agent and your Stream Deck. It has two parts:

1. **The bridge** — a small local server that receives events from Claude Code (via hooks) and tracks what the agent is doing: idle, thinking, waiting for approval, executing a tool, or stopped.

2. **The plugin** — runs inside the Stream Deck app. It draws buttons, handles your key presses, and talks to the bridge over a local connection.

The mental model is simple: Claude Code tells the bridge what's happening, the bridge tells the plugin, and the plugin updates your buttons. When you press a button, the reverse happens — the plugin tells the bridge, and the bridge tells Claude Code what to do.

## What You Can Do

- **Approve or deny tool calls** without switching to your terminal
- **Cancel a runaway agent** with one tap
- **Send canned prompts** ("run the tests", "commit", "explain this error") to your AI app
- **Monitor agent state** on a status widget — see if Claude is thinking, waiting, or idle
- **Start voice dictation** in Claude with one button

## Requirements

- macOS 13+
- Node.js 20+
- Stream Deck app 6.6+ (with the `streamdeck` CLI: `npm install -g @elgato/cli`)
- Claude Code with hooks enabled (the installer handles this)

## Getting Started

### Step 1: Install

```bash
git clone https://github.com/billroy/decky.git
cd decky
./install.sh
```

The installer does five things:
1. Installs npm dependencies for the bridge and plugin
2. Builds the plugin
3. Copies hook scripts to `~/.decky/hooks/`
4. Registers the hooks in `~/.claude/settings.json`
5. Links the plugin into the Stream Deck app

### Step 2: Start the Bridge

```bash
./start.sh
```

Leave this running in a terminal. The bridge listens on `http://localhost:9130`. You need it running whenever you want Decky to work.

### Step 3: Restart the Stream Deck App

Quit and reopen the Stream Deck app so it picks up the new plugin.

### Step 4: Place Your First Button

In the Stream Deck app:

1. Look for **Decky Slot** in the action list (under Custom)
2. Drag it onto a key

That's it — you have a working Decky button. It ships with "Continue" as the default for slot 0.

### Step 5: Fill Your Deck

Drag **Decky Slot** onto every key you want Decky to control. Decky only manages keys that have a Decky Slot assigned — it leaves all your other Stream Deck buttons alone.

A standard 15-key Stream Deck works well. Fill all 15 keys with Decky Slots.

## The Big Idea: Buttons That Change

Here's the key concept: **every Decky Slot is the same kind of button, but it changes what it shows and does based on what your agent is doing.**

When Claude is **idle**, your buttons show your configured macros — "Continue", "Yes", "No", "Summarize", and whatever else you've set up. This is your prompt palette.

When Claude is **waiting for approval** (it wants to run a tool and is asking permission), those same buttons automatically transform:

| Key | Idle | Waiting for Approval |
|-----|------|---------------------|
| Slot 0 | Continue | **Approve** ✓ (green) |
| Slot 1 | Yes | **Deny** ✗ (red) |
| Slot 2 | No | **Cancel** ⏹ (yellow) |
| Slot 3 | Stop | *tool name* |
| Slot 4+ | your macros | empty |

You don't reconfigure anything. The buttons shift automatically and shift back when Claude returns to idle.

The full layout by state:

| State | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slots 4+ |
|-------|--------|--------|--------|--------|----------|
| **Idle** | Macro 0 | Macro 1 | Macro 2 | Macro 3 | Your macros |
| **Thinking** | Thinking... | Stop ⏹ | — | — | — |
| **Awaiting approval** | Approve ✓ | Deny ✗ | Cancel ⏹ | Tool name | — |
| **Executing tool** | Stop ⏹ | Tool name | — | — | — |
| **Stopped** | Restart ↻ | — | — | — | — |

This means all 15 keys on your deck serve double duty. You don't have to permanently reserve keys for approve/deny/cancel — they appear when needed and disappear when they're not.

## Configuring Your Buttons

Click any Decky Slot in the Stream Deck app to open the Property Inspector (PI). This is where you customize what each button does and looks like.

The PI has three sections:

### Global Behavior

Settings that affect the whole deck:

- **Theme** — Choose a color scheme (Light, Dark, Dracula, Monokai, Nord, and 9 others). Themes control the default colors for all your buttons.
- **Approval timeout** — How long the bridge waits for you to approve/deny before timing out (5–300 seconds).
- **Target badge** — Show a small badge on macro buttons indicating which app they target.
- **Theme apply strategy** — When switching themes, choose whether to keep your color customizations or let the theme override them.

### Global Appearance

Default colors for all buttons on this page:

- **Background**, **text**, and **icon** colors
- These are overridden by per-slot colors if you set those

### Selected Slot Settings

Configure the specific button you clicked on:

- **Label** — The text shown on the button (max 20 characters)
- **Icon** — Pick from built-in icons (check, x, star, rocket, terminal, git-branch, bug, and many more)
- **Text** — The prompt text to send when pressed (max 2000 characters)
- **Type** — What kind of action this slot performs (see below)
- **Target app** — Which app receives the text (Claude, Codex, ChatGPT, Cursor, Windsurf), or "Use default"
- **Submit** — Whether to press Return after pasting the text
- **Colors** — Per-slot background, text, and icon color overrides

Colors resolve in layers: theme → page defaults → slot override. A slot override always wins.

## Slot Types: What Each Button Can Do

The **Type** dropdown is where you choose what a button does. Most of the time you'll use the default ("Command"), but the other types exist for specific use cases.

### Command (default)

A text macro. When pressed, Decky copies your text to the clipboard, activates the target app, pastes it, and (optionally) presses Return to send.

Use this for canned prompts: "Continue", "run the tests", "explain this error", "commit and push". This is the bread and butter of Decky.

### Approve / Deny / Cancel / Restart

These are the approval workflow buttons. Normally you don't need to assign these manually — the layout system puts them on your deck automatically when Claude is waiting for approval.

**When would you assign these manually?** If you have a large deck (32 keys) and want dedicated approve/deny buttons that are always visible, even during idle. On a 15-key deck, let the automatic layout handle it.

- **Approve** — Tells Claude "yes, run this tool" (writes to the approval gate file)
- **Deny** — Tells Claude "no, skip this tool"
- **Cancel** — Stops the current operation entirely
- **Restart** — Resets a stopped session back to idle

### Widget

Displays a live status readout on the button face: bridge connection state, current agent state (idle/thinking/etc.), and how long ago the last state change happened.

Press the button to refresh the display, or set it to auto-refresh on an interval (1–60 minutes).

Useful for monitoring — put one on the corner of your deck so you can always see what Claude is doing.

### Approve Once (Claude)

A specialized approve that does two things at once:
1. Approves the pending tool call (same as regular Approve)
2. Activates the Claude desktop app and presses Return (simulates clicking the approve button in Claude's own UI)

Use this if you're running Claude Code through the Claude desktop app and need to dismiss both the hook approval AND the app's approval dialog.

### Talk to Claude

Activates the Claude desktop app and opens Edit → Start Dictation. One-tap voice input to Claude.

### Open Config

Reserved for future use. Currently renders a gear icon but does nothing when pressed.

## Suggested Deck Layouts

### 15-key Stream Deck (recommended starting point)

```
[ Continue ] [   Yes   ] [   No    ] [  Stop   ] [Summarize]
[Make it so] [ Commit  ] [ Deploy  ] [  Usage  ] [Session? ]
[  Widget  ] [         ] [         ] [         ] [  Talk   ]
```

- Slots 0–9: Macros for common prompts (the defaults are a good starting point)
- Slot 10: Bridge status widget for monitoring
- Slot 14: Talk to Claude for voice input
- Slots 11–13: Empty, ready for your own macros

When Claude asks for approval, slots 0–2 automatically become Approve/Deny/Cancel. Slot 3 shows the tool name. Everything else goes blank until you respond.

### 6-key Stream Deck Mini

```
[ Continue ] [   Yes   ] [   No    ]
[  Widget  ] [  Stop   ] [  Talk   ]
```

Fewer keys means you rely more on the automatic layout. The top row is your most-used macros (which become approve/deny/cancel during approval). The bottom row is fixed utilities.

### 32-key Stream Deck XL

With 32 keys you have room for dedicated workflow buttons:

```
[ Continue ] [   Yes   ] [   No    ] [  Stop   ] [Summarize] [Make it so] [ Commit  ] [ Deploy  ]
[  Usage   ] [Session? ] [  Tests  ] [  Debug  ] [  Explain ] [  Refactor] [   PR    ] [  Review ]
[         ] [         ] [         ] [         ] [         ] [         ] [         ] [         ]
[ Approve  ] [  Deny   ] [ Cancel  ] [ Restart ] [  Widget  ] [  Talk   ] [Approve1x] [         ]
```

Bottom row: Fixed approval buttons that are always visible. This lets you approve without waiting for the layout to shift. The dynamic layout still works on the top rows.

## Themes

Decky ships with 13 themes:

- **Light**, **Dark** — Clean defaults
- **Dracula**, **Monokai**, **Nord**, **GitHub Dark** — Developer favorites
- **Solarized Dark**, **Solarized Light** — Low-contrast options
- **Candy Cane**, **Gradient Blue**, **Wormhole** — Colorful
- **Rainbow**, **Random** — Each button gets a different color (use the theme seed slider to control which colors)

When you switch themes, the PI asks how to handle your existing color overrides:

- **Keep overrides** — Theme fills in colors you haven't customized
- **Clear page defaults, keep macro overrides** — Resets global colors but preserves per-slot colors
- **Clear all overrides** — Full theme reset

## Target Apps

Macros can target different AI coding apps:

| App | Badge |
|-----|-------|
| Claude (default) | CLD |
| Codex | CDX |
| ChatGPT | CGP |
| Cursor | CSR |
| Windsurf | WDF |

Set a default target in Global Behavior. Override per-slot in Selected Slot Settings. Enable "Show target badge" to display a small app indicator on each button.

## Recovery and Backups

Config is saved to `~/.decky/config.json` with automatic rotation backups (`config.json.bak.0` through `config.json.bak.9`, newest first).

If something goes wrong:

```bash
# List available backups
node scripts/recover-config.mjs --target-count 13

# Restore a specific backup (0 = most recent)
node scripts/recover-config.mjs --restore 0
```

Or use the REST API:

```bash
# List backups
curl http://localhost:9130/config/backups

# Restore backup 0
curl -X POST http://localhost:9130/config/restore -H 'Content-Type: application/json' -d '{"index": 0}'
```

## Troubleshooting

**Buttons show "..." (three dots):** The slot is unconfigured. Click it in the Stream Deck app and set a label and text, or it's intentionally empty.

**Buttons don't respond to presses:** Check that the bridge is running (`./start.sh`). The plugin can't do anything without it.

**Bridge not receiving events from Claude:** Make sure hooks are registered. Check `~/.claude/settings.json` — you should see entries pointing to `~/.decky/hooks/*.sh`.

**Approval buttons don't appear:** They only appear when Claude is in the "awaiting-approval" state. If Claude isn't asking for approval, you'll see your macros instead.

**Theme not applying:** After selecting a theme, choose an apply strategy and click Apply. If colors look wrong, try "Clear all overrides" to start fresh.

## Development

```bash
# Bridge (dev mode with auto-reload)
cd bridge && npm run dev

# Plugin (watch mode)
cd plugin && npm run watch

# Tests
cd bridge && npm test
cd plugin && npm test
cd plugin && npm run test:pi
```

After changing plugin code, rebuild and restart the Stream Deck app:

```bash
cd plugin && npm run build
# Then quit and reopen Stream Deck
```

## REST API

The bridge exposes these endpoints on `http://localhost:9130`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/hook` | Receives Claude Code hook events |
| `GET` | `/status` | Current state snapshot |
| `GET` | `/config` | Current configuration |
| `PUT` | `/config` | Save configuration |
| `POST` | `/config/reload` | Reload config from disk |
| `GET` | `/config/backups` | List backup metadata |
| `POST` | `/config/restore` | Restore backup by index |

## License

MIT
