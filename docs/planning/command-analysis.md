# Command Dropdown Analysis

## Overview

The "Type" dropdown in the Selected Slot settings offers 9 command types. This document explains what each does, why it exists, and how they fit together.

The dropdown is defined in `property-inspector-v2.html:601-611`:

| Value | Label | Category |
|-------|-------|----------|
| `macro` | Command | Text injection |
| `widget` | Widget | Status display |
| `approve` | Approve | Approval workflow |
| `deny` | Deny | Approval workflow |
| `cancel` | Cancel | Approval workflow |
| `restart` | Restart | Approval workflow |
| `openConfig` | Open Config | Utility (reserved) |
| `approveOnceInClaude` | Approve Once (Claude) | Claude automation |
| `startDictationForClaude` | Talk to Claude | Claude automation |

## Execution Flow

All commands follow the same path until they diverge at the bridge:

```
StreamDeck button press
  → SlotAction.onKeyDown() [plugin/src/actions/slot.ts]
  → BridgeClient.sendAction(action, data) [plugin/src/bridge-client.ts]
  → Socket.io "action" event to bridge
  → bridge/src/app.ts:203 handler dispatches by action type
```

## Command Categories

### 1. Approval Workflow Commands (approve, deny, cancel, restart)

These are the **core purpose of Decky** — physical buttons for Claude Code's tool approval workflow.

**Why they exist:** Claude Code's hook system pauses execution when a tool needs approval. The `pre-tool-use.sh` hook POSTs to the bridge and polls a gate file. These commands write the user's decision to that gate file, unblocking the hook.

| Command | Gate file value | State transition | Active when |
|---------|----------------|------------------|-------------|
| `approve` | `"approve"` | → `tool-executing` | `awaiting-approval` |
| `deny` | `"deny"` | → `thinking` | `awaiting-approval` |
| `cancel` | `"cancel"` | → `stopped` | `awaiting-approval`, `executing`, `thinking` |
| `restart` | *(none)* | → `idle` | `stopped` |

Handler: `bridge/src/app.ts:206-222`. The first three write the approval gate file via `writeGateFile()` then call `sm.forceState()`. Restart only resets the state machine — there's no gate file involved because no hook is waiting.

**Why four separate commands instead of a single "respond" command:** Each maps to a dedicated physical button with a distinct color and icon. A surgeon doesn't want a dropdown menu during an operation — they want clearly labeled, always-visible buttons. The same applies here: when Claude is about to run `rm -rf`, you want an unambiguous red Deny button, not a generic "respond" button with a sub-menu.

### 2. Text Injection (macro)

**What it does:** Copies user-defined text to the clipboard, activates a target app (Claude, Codex, ChatGPT, Cursor, or Windsurf), pastes with Cmd+V, and optionally presses Return to submit.

**Why it exists:** Lets users create one-tap shortcuts for frequently used prompts. Examples: "run the tests", "explain this error", "commit and push". This turns the StreamDeck into a prompt palette.

**Configuration fields:** `label`, `text` (up to 2000 chars), `icon` (Lucide icon name), `targetApp`, `submit` (boolean).

Handler: `bridge/src/app.ts:223-241` → `macro-exec.ts:executeMacro()`. Uses `pbcopy` + AppleScript (macOS-only, see `ports.md`).

### 3. Status Widget (widget)

**What it does:** Displays live bridge status on the StreamDeck key face — connection state, current Claude state (idle/thinking/awaiting-approval/etc.), and time since last update.

**Why it exists:** Without this, you'd have to check your screen to know what Claude is doing. The widget lets you glance at the StreamDeck and see at a glance: is Claude thinking? waiting for approval? disconnected?

**Configuration:** Widget kind (`bridge-status` is the only kind), refresh mode (`onClick` or `interval`), and interval minutes (1-60).

Handler: When pressed, emits `widget-refresh` which triggers `renderAll()` in `plugin/src/actions/slot.ts:211` — a local re-render, not a bridge round-trip.

### 4. Claude Automation (approveOnceInClaude, startDictationForClaude)

These combine bridge actions with macOS GUI automation via AppleScript.

#### approveOnceInClaude

**What it does:** Two things at once:
1. Writes `"approve"` to the gate file (same as the regular `approve` command)
2. Activates the Claude desktop app and presses Return (simulates clicking the approve button in Claude's own UI)

**Why it exists separately from `approve`:** The regular `approve` command only unblocks the hook. But if Claude's desktop app is also showing an approval dialog, you'd need to click that too. This command handles both in one tap. It's for users running Claude Code through the Claude desktop app where both the hook gate AND the app UI need approval.

Handler: `bridge/src/app.ts:242-251` → `macro-exec.ts:approveOnceInClaude()`.

#### startDictationForClaude

**What it does:** Activates the Claude desktop app, then uses AppleScript UI scripting to click Edit → "Start Dictation..." in the menu bar.

**Why it exists:** Voice input to Claude via one StreamDeck tap. Instead of switching to Claude, finding the Edit menu, and clicking Start Dictation, you press one button.

Handler: `bridge/src/app.ts:252-256` → `macro-exec.ts:startDictationForClaude()`.

**Why these aren't just macros:** Macros paste text. These commands automate GUI elements (menu items, keypresses in specific apps) — they don't inject text content. A macro can't click a menu item.

### 5. Utility (openConfig)

**What it does:** Currently a reserved placeholder. Renders a gear icon but has no bridge handler.

**Why it exists:** Intended for future use — opening the Property Inspector or bridge config from a StreamDeck button. Kept in the dropdown because removing it could break existing user configurations that reference it.

## Why So Many Commands?

The 9 types break down into three concerns that can't be collapsed:

1. **State machine control** (approve/deny/cancel/restart) — These are the product's core value. Each needs a distinct button because they have different consequences and must be visually unambiguous.

2. **App automation** (macro/approveOnceInClaude/startDictationForClaude) — These automate macOS GUI interactions. They differ in mechanism: macros paste text, approveOnce combines gate-writing with app activation, and dictation clicks a menu item.

3. **Information display** (widget) — Fundamentally different from actions — it renders status rather than performing an action.

4. **Reserved** (openConfig) — Placeholder for future functionality.

Could any be merged? The approval commands (approve/deny/cancel) could theoretically be one command with a parameter, but that would require a sub-selection step on a physical button — defeating the purpose of instant, unambiguous physical controls. The two Claude automation commands could theoretically be macros, but they use AppleScript menu/keystroke automation that macros don't support. The widget is inherently different from everything else.

## Decky Slots: The Dynamic Layout System

### What Decky Slots Are

The entire StreamDeck plugin registers a single action type: **Decky Slot** (`com.decky.controller.slot`). Every key on the deck is the same kind of button. There are no separate "approve button" or "status button" action types — there is only the Decky Slot.

A Decky Slot is a **chameleon button** that changes its icon, label, color, and behavior based on the current state of Claude Code. When Claude is idle, your slots show your configured macros. When Claude asks for tool approval, those same physical keys transform into Approve / Deny / Cancel buttons. When the session stops, slot 0 becomes a Restart button. The user doesn't reconfigure anything — the layout shifts automatically.

### How It Works

Each Decky Slot placed on the StreamDeck computes a **slot index** from its physical position (`row * columns + column`). When the bridge emits a state change, every active slot calls `getSlotConfig(state, slotIndex, toolName, macros)` in `plugin/src/layouts.ts` to determine what it should look like and do right now.

The layout table:

| State | Slot 0 | Slot 1 | Slot 2 | Slot 3 | Slots 4+ |
|-------|--------|--------|--------|--------|----------|
| **idle** | Macro 0 | Macro 1 | Macro 2 | Macro 3 | Macros from config |
| **thinking** | Thinking... | Stop ⏹ | — | — | Empty |
| **awaiting-approval** | Approve ✓ | Deny ✗ | Cancel ⏹ | Tool name | Empty |
| **tool-executing** | Stop ⏹ | Tool name | — | — | Empty |
| **stopped** | Restart ↻ | — | — | — | Empty |

When Claude transitions from idle → awaiting-approval, `renderAll()` fires and every Decky Slot on the deck re-renders simultaneously. Slot 0 changes from "Continue" (or whatever macro you configured) to a green Approve button. Slot 1 changes from "Yes" to a red Deny button. No user interaction required.

### Slots vs. Fixed Command Types

The Type dropdown in the Property Inspector lets you **override** a slot's idle-state behavior. By default, a slot in idle state acts as a text macro (type `"macro"`). But you can set any slot to be a widget, or a fixed approve button, or a dictation trigger.

The key distinction:

- **Default slot behavior (type `"macro"` or unset):** The slot is fully dynamic. In idle state it shows whatever macro is configured at that index. In non-idle states, the layout system takes over — the slot becomes whatever the current state requires for that position (approve, deny, stop, etc.).

- **Fixed command types (approve, deny, widget, etc.):** The slot always performs that specific action regardless of state. A slot set to type `"widget"` always shows bridge status. A slot set to type `"approve"` always sends an approve action when pressed. These override the layout system.

### When to Use Each

**Use default Decky Slots (type `"macro"`)** for most of your deck. This is the intended workflow:

- Configure your macros ("Continue", "run tests", "explain this", etc.) via the Property Inspector
- During idle, your macros are visible and usable
- When Claude needs approval, the same keys automatically become workflow buttons
- When Claude finishes, they return to your macros
- You get a full prompt palette AND approval controls on the same physical keys

**Use fixed command types** only when you want a key that never changes:

- A **widget** slot to always show status, even during idle
- A dedicated **approve** button that stays green regardless of state (useful if you have a large deck and want persistent workflow controls alongside dynamic slots)
- An **approveOnceInClaude** or **startDictationForClaude** button that's always accessible
- These are for users who have enough StreamDeck keys to dedicate some to fixed functions while letting others be dynamic

### Why This Design?

The alternative — separate action types for approve, deny, cancel, status, and macros — was the original design. It required users to manually place each button type and left most keys unused during approval states. The unified Decky Slot replaces all of those with a single action that adapts to context.

This matters because a typical StreamDeck has 15 keys. With fixed action types, you'd need 4 keys permanently reserved for approval workflow (approve/deny/cancel/restart), 1 for status, leaving only 10 for macros. With Decky Slots, all 15 keys show macros during idle and the first few automatically become workflow buttons only when needed.

The old per-action files (`plugin/src/actions/approve.ts`, `deny.ts`, `cancel.ts`, `status.ts`) still exist in the codebase but are no longer registered in `plugin/src/plugin.ts`. Only `SlotAction` is registered.

## Configuration Limits

From `bridge/src/config.ts`:

| Limit | Value |
|-------|-------|
| Max slots per deck | 36 |
| Max label length | 20 chars |
| Max macro text | 2000 chars |
| Max icon name | 64 chars |
| Approval timeout range | 5-300 seconds |
