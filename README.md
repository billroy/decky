# Decky

**Stream Deck controller for AI coding assistants** — approve, deny, inject commands, and monitor tool use from hardware keys.

Decky turns your Elgato Stream Deck into a physical control surface for AI coding workflows. When Claude Code (or another supported assistant) requests permission to run a tool, your Stream Deck lights up with Approve / Deny / Cancel buttons. Press a key instead of reaching for the mouse. Between approvals, the same keys become programmable command buttons that inject prompts directly into your AI assistant.

## How It Works

Decky has two components that run locally on your machine:

1. **Bridge** — a lightweight Node.js server that receives hook events from Claude Code, tracks state, and communicates with the Stream Deck plugin over Socket.io.
2. **Plugin** — runs inside the Elgato Stream Deck app. Renders dynamic key images, routes key presses to the bridge, and hosts the Property Inspector UI for configuration.

You drag **Decky Slot** actions onto your Stream Deck keys. Each slot dynamically changes its appearance and behavior based on the current state of your AI session — showing approval buttons when permission is needed, command buttons when idle, and status indicators while tools execute.

## Prerequisites

Install these before running the Decky installer:

| Prerequisite                | How to install                                        |
|:----------------------------|:------------------------------------------------------|
| **Elgato Stream Deck**      | Hardware — any model supported by the Stream Deck app |
| **Stream Deck app** 6.6+    | [Download from Elgato](https://www.elgato.com/downloads) |
| **Node.js** 20+             | [nodejs.org](https://nodejs.org/) or your package manager |
| **Git**                     | [git-scm.com](https://git-scm.com/) or your package manager |
| **Stream Deck CLI**         | `npm install -g @elgato/cli` (used to link the plugin) |
| **Claude Code**             | [claude.ai/download](https://claude.ai/download) — latest version |

**Linux only:** also install `xdotool` and `xclip` for text injection and window management:

```bash
# Debian/Ubuntu
sudo apt install xdotool xclip

# Fedora
sudo dnf install xdotool xclip

# Arch
sudo pacman -S xdotool xclip
```

### Supported Platforms

| Platform         | Status           | Notes                                       |
|:-----------------|:-----------------|:--------------------------------------------|
| **macOS 13+**    | Tested           | Full feature support                        |
| **Windows 10+**  | Experimental     | Pending user testing                        |
| **Linux (X11)**  | Experimental     | Requires `xdotool` and `xclip` (see above)  |
| **Linux (Wayland)** | Not supported | Wayland security model blocks window automation |

## Installation

### 1. Clone and install

```bash
git clone https://github.com/billroy/decky.git
cd decky
./install.sh
```

The install script installs npm dependencies, builds the plugin, copies hook scripts to `~/.decky/hooks/`, registers hooks in `~/.claude/settings.json`, and links the plugin into the Stream Deck app.

### 2. Start the bridge

```bash
./start.sh
```

The bridge listens on `http://localhost:9130`.

### 3. Add slots to your Stream Deck

Open the Stream Deck app, find **Decky Slot** under Custom actions, and drag it onto every key you want Decky to control. Click each key to configure it in the Property Inspector.

## Uninstallation

```bash
node hooks/uninstall.js
```

This removes hook scripts from `~/.decky/hooks/` and cleans Decky entries from `~/.claude/settings.json`. To fully remove:

1. Delete the plugin from your Stream Deck plugins directory
2. Restart the Stream Deck app
3. Optionally remove `~/.decky/` (contains config and bridge token)

## User's Guide

### Slot Types

Every Decky key is a **slot**. Each slot has a **type** that determines what the key does when pressed and how it appears. Configure the type in the Property Inspector by clicking a key in the Stream Deck app.

| Type                       | What it does                                                    |
|:---------------------------|:----------------------------------------------------------------|
| **Command**                | Injects a text prompt into your AI assistant and optionally submits it |
| **Approve**                | Approves the current tool-use request                           |
| **Deny**                   | Denies the current tool-use request                             |
| **Stop**                   | Cancels execution or dismisses the approval dialog              |
| **Restart**                | Resets bridge state to idle                                     |
| **Approve Once (Claude)**  | Clicks the approval button directly in the Claude app           |
| **Talk to Claude**         | Starts voice dictation in Claude (macOS only)                   |
| **Widget**                 | Displays live status information (bridge connection state)      |

### Configuring Command Slots

Command slots are the most flexible type. When pressed, they:

1. Copy your prompt text to the clipboard
2. Activate the target AI app
3. Paste the text
4. Optionally press Enter to submit
5. Restore focus to your previous window

To set up a command slot:

1. Set **Type** to "Command"
2. Enter a **Label** (shown on the key, max 20 characters)
3. Enter the **Prompt** text (what gets injected, max 2000 characters)
4. Choose a **Target** app (or leave as "Use default" to use the global setting)
5. Toggle **Submit** on/off (when on, presses Enter after pasting)
6. Optionally pick an **Icon** and adjust **Font size**

**Example commands:**
- `Continue` — nudge the assistant to keep going
- `Yes` / `No` — quick answers
- `Commit` — tell the assistant to commit changes
- `Show usage` — check token consumption
- `Summarize what you've done so far.` — get a status update

### Configuring Approval Slots

For the core approval workflow, create three slots:

| Slot     | Type      | What happens                                          |
|:---------|:----------|:------------------------------------------------------|
| Approve  | Approve   | Approves tool use; bridge writes gate file or clicks approval button |
| Deny     | Deny      | Denies tool use; returns to idle                      |
| Stop     | Stop      | Cancels regardless of state; dismisses any open dialog |

When Claude Code requests permission to use a tool, these keys light up. Press one to respond. The stream deck shows which tool is requesting approval.

### Approval Queue

If multiple approval requests arrive while you're deciding, they queue up. The Stream Deck shows the count of pending approvals. After you respond to one, the next queued request activates automatically.

### Target Apps

Decky can inject commands into multiple AI coding assistants:

| Target App | Identifier | Notes                              |
|:-----------|:-----------|:-----------------------------------|
| Claude     | `claude`   | Claude for Desktop                 |
| Codex      | `codex`    | OpenAI Codex CLI                   |
| ChatGPT    | `chatgpt`  | ChatGPT desktop app                |
| Cursor     | `cursor`   | Cursor editor                      |
| Windsurf   | `windsurf` | Windsurf editor                    |

Set the default target in **Global Behavior > Default Target App**. Override per-slot in the slot's Target dropdown.

### Widgets

Widget slots display live information. Currently available:

- **Bridge status** — shows connection state (connected/disconnected/error) with a colored indicator. Refresh mode can be "On click" or on a timed interval (1-60 minutes).

### Themes

Decky includes 13 built-in themes that control key colors across all slots:

| Theme            | Style                                  |
|:-----------------|:---------------------------------------|
| Light            | Clean white background                 |
| Dark             | Dark gray background                   |
| Dracula          | Purple-accented dark theme             |
| Monokai          | Warm dark with yellow/green accents    |
| Solarized Dark   | Ethan Schoonover's dark palette        |
| Solarized Light  | Ethan Schoonover's light palette       |
| Nord             | Arctic blue palette                    |
| GitHub Dark      | GitHub's dark mode colors              |
| Candy Cane       | Red and white holiday theme            |
| Gradient Blue    | Blue gradient tones                    |
| Wormhole         | Deep purple/magenta space theme        |
| Rainbow          | Each slot gets a different hue         |
| Random           | Random theme on each apply             |

**Theme apply strategies** control how themes interact with your color customizations:

| Strategy             | Effect                                              |
|:---------------------|:----------------------------------------------------|
| Keep overrides       | Theme fills in where no custom colors are set        |
| Clear page defaults  | Resets global colors, keeps per-slot overrides       |
| Clear all            | Resets all color overrides before applying the theme |

### Color Customization

Colors can be set at two levels:

1. **Global** (page defaults) — background, text, and icon colors that apply to all slots
2. **Per-slot** — override any color for a specific slot only

Resolution order: slot override > page default > theme.

### Global Settings

| Setting              | Default   | Description                                      |
|:---------------------|:----------|:-------------------------------------------------|
| Approval Timeout     | 30s       | Seconds before approval auto-expires (5-300)     |
| Default Target App   | Claude    | Which app receives command text by default        |
| Show Target Badge    | Off       | Display target app abbreviation on command keys   |
| Pop Up App           | Off       | Bring target app to front on approval requests    |
| Enable Approve Once  | On        | Show "Approve Once (Claude)" as a slot type       |
| Enable Dictation     | On        | Show "Talk to Claude" as a slot type              |

## Platform Feature Matrix

Features available vary by platform. Text injection and approval automation require platform-specific window management APIs.

| Feature                        | macOS          | Windows         | Linux (X11)     |
|:-------------------------------|:--------------:|:---------------:|:---------------:|
| Bridge server                  | Yes            | Yes             | Yes             |
| Plugin + Property Inspector    | Yes            | Yes             | Experimental *  |
| Approve / Deny / Cancel        | Yes            | Yes             | Yes             |
| State display + widgets        | Yes            | Yes             | Yes             |
| Config editing via PI          | Yes            | Yes             | Yes             |
| Command buttons (text inject)  | Yes            | Yes             | Yes             |
| Approve Once (in-app click)    | Yes            | Yes             | Yes             |
| Dismiss approval (in-app)      | Yes            | Yes             | Yes             |
| Talk to Claude (dictation)     | Yes            | No              | No              |
| Focus capture + restore        | Yes            | Yes             | Yes             |
| UI Automation (button finding) | AppleScript    | .NET UIA        | Keystroke only  |

\* *No official Elgato Stream Deck host exists for Linux. Community tools may not fully implement SDK v2.*

### Implementation Details by Platform

| Component        | macOS                 | Windows                      | Linux (X11)            |
|:-----------------|:----------------------|:-----------------------------|:-----------------------|
| Clipboard        | `pbcopy`              | `clip.exe`                   | `xclip`                |
| App activation   | AppleScript           | PowerShell + SetForegroundWindow | `xdotool windowactivate` |
| Keystrokes       | AppleScript System Events | PowerShell SendKeys      | `xdotool key`          |
| Button clicking  | Accessibility API     | UI Automation (.NET)         | Keystroke fallback     |
| App identification | Bundle IDs          | Process names                | WM_CLASS               |
| Dictation        | Edit > Start Dictation | Not available               | Not available          |

## AI Provider Support

Decky works with multiple AI coding assistants. The hook integration is designed for Claude Code, but command injection works with any supported target app.

### Provider Testing Status

| Provider          | Hook Integration | Command Injection | Approval Automation | Testing Status   |
|:------------------|:----------------:|:-----------------:|:-------------------:|:-----------------|
| **Claude Code**   | Yes              | Yes               | Yes                 | Tested           |
| **Codex CLI**     | Via Claude hooks | Yes               | Yes                 | Tested           |
| **ChatGPT**       | Via Claude hooks | Yes               | No                  | Experimental     |
| **Cursor**        | Via Claude hooks | Yes               | Yes (as Codex)      | Experimental     |
| **Windsurf**      | Via Claude hooks | Yes               | No                  | Experimental     |

**Hook Integration:** Claude Code hooks drive the state machine (idle, thinking, awaiting-approval, tool-executing, stopped). Other providers use Claude hooks as the event source.

**Command Injection:** Clipboard + paste works for all providers. The target app is activated, text is pasted, and Enter is optionally pressed.

**Approval Automation:** "Approve Once" and "Dismiss" directly interact with the approval dialog in the target app. This requires finding and clicking buttons via accessibility APIs, which is app-specific and may break across versions.

### Platform + Provider Matrix

|                    | macOS (Tested) | Windows (Experimental) | Linux X11 (Experimental) |
|:-------------------|:--------------:|:----------------------:|:------------------------:|
| **Claude Code**    | Full support   | Full support           | Full support             |
| **Codex CLI**      | Full support   | Full support           | Full support             |
| **ChatGPT**        | Commands only  | Commands only          | Commands only            |
| **Cursor**         | Full support   | Full support           | Full support             |
| **Windsurf**       | Commands only  | Commands only          | Commands only            |

*"Full support" = commands + approval automation. "Commands only" = text injection works, approval button-clicking not implemented.*

## Recovery and Backups

Config writes are protected with atomic saves and rotation backups.

- **Active config:** `~/.decky/config.json`
- **Backups:** `config.json.bak.0` (newest) through `config.json.bak.9`

Restore via the bridge API:
```bash
# List backups
curl -H "Authorization: Bearer $(cat ~/.decky/bridge-token)" http://localhost:9130/config/backups

# Restore backup 0 (most recent)
curl -X POST -H "Content-Type: application/json" \
     -H "Authorization: Bearer $(cat ~/.decky/bridge-token)" \
     -d '{"index": 0}' http://localhost:9130/config/restore
```

## Development

```bash
# Bridge (dev mode with auto-reload)
cd bridge && npm run dev

# Plugin (watch mode)
cd plugin && npm run watch

# Tests
cd bridge && npm test          # 198 tests
cd plugin && npm test          # 102 tests (unit)
cd plugin && npm run test:pi   # PI Playwright tests
```

### Rebuild + Restart

After changing plugin or PI code:

```bash
cd plugin && npm run build
```

Then restart the Stream Deck app. The bridge does not need restarting for plugin changes.

## REST API

All endpoints require authentication via `Authorization: Bearer <token>` or `X-Decky-Token` header. The token is stored in `~/.decky/bridge-token`.

| Method | Endpoint            | Description                    | Rate Limit |
|:-------|:--------------------|:-------------------------------|:-----------|
| POST   | `/hook`             | Receive Claude hook events     | 200/min    |
| GET    | `/status`           | Current state + capabilities   | -          |
| GET    | `/config`           | Current configuration          | 60/min     |
| PUT    | `/config`           | Save configuration             | 60/min     |
| POST   | `/config/reload`    | Reload config from disk        | 60/min     |
| GET    | `/config/backups`   | List backup metadata           | 60/min     |
| POST   | `/config/restore`   | Restore backup by index        | 60/min     |

## License

MIT
