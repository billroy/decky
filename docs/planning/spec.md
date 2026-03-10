# StreamDeck Controller for Claude.app — Spec

**Goal:** Develop a way to control **Claude.app** (the Anthropic desktop application for macOS) using an Elgato StreamDeck MK.2.

## Pain Point

When Claude.app needs approval to execute a tool or enter an implementation phase, it is painful to scuff the mouse across the screen, surface the app, and click the approval. Doing this 100 times/day has reactivated RMS in my neck — literally a pain in the neck. A context-sensitive set of StreamDeck buttons that automatically update to reflect Claude.app's state and provide one-button approval/disapproval/stop should fix this.

## Scope

- **Target app:** Claude.app on macOS (desktop GUI)
- **Device:** Elgato StreamDeck MK.2
- **Users:** Single user, localhost only — no auth, no TLS, no multi-tenancy
- **State detection:** Via Claude Code lifecycle hooks (`PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`) registered in `~/.claude/settings.local.json` — the correct technical approach
- **States to cover:** Derive the complete taxonomy from Claude Code hooks and observable Claude.app behavior

## Reference Projects

- **AgentDeck** — https://github.com/puritysb/AgentDeck
  StreamDeck+ bridge for Claude Code; Node.js bridge + WebSocket; Claude Code hooks; PTY management; dynamic layouts; voice input; token monitoring

- **TerminalDeck** — https://github.com/sidmohan0/terminaldeck
  macOS app for hands-free Claude Code control; HID-direct StreamDeck; AppleScript terminal integration; approval buttons; voice dictation

Review both to derive a complete feature set for this project.

## Technical Constraints & Preferences

- **Server-client comms:** Always use Socket.io with a two-way command-and-event pattern
- **Frontend:** No React, no GraphQL. Prefer Vue.js
- **Persistence:** JSON file-based for prototype; evaluate SQLite for event logging. Impute persistence requirements from AgentDeck/TerminalDeck feature sets.
- **Architecture options to evaluate:** Electron app, Node.js+Express, Python+Flask — and any others worth considering

## Deliverable

Produce `initial-analysis.md` containing:
1. Complete Claude.app / Claude Code state taxonomy
2. Full feature set proposal (informed by AgentDeck, TerminalDeck, and first principles)
3. Architecture recommendation with rationale
4. Implementation plan staged in phases of **< 20 minutes of AI coding time each** (phases must be independently runnable; this constraint exists to manage session restarts after crashes and token exhaustion)
5. Open issues with recommendations for resolution
