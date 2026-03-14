# Decky — Competitive Analysis & Feature Roadmap

Date: 2026-03-11
Scope: All 15 repositories returned by the GitHub search `stream deck claude` (2 pages, best-match order)
Method: Full README review, source-code inspection where available, cross-referenced against the Decky feature set in `README.md`, `bridge/src/`, and `plugin/`

---

## 1. Competitor Registry

### 1.1 Significant Competitors (Starred / Feature-Rich)

| Repo | Stars | Lang | Last Updated | Core Concept |
|:-----|------:|:-----|:-------------|:-------------|
| puritysb/AgentDeck | 24 | TypeScript | 2026-03-10 | Full-featured PTY proxy + whisper.cpp voice + Android companion |
| sidmohan0/terminaldeck | 22 | TypeScript/Rust | 2026-01-07 | Native macOS Tauri app, HID direct, terminal management |
| etechlead/claude-deck | 5 | TypeScript | 2025-08-18 | Multi-task visual monitoring, tap-to-clear slots |
| joachimschmidt/streamdeck-macos-plugins | 3 | TypeScript | 2026-03-05 | macOS plugin suite including Claude Approve, file-based IPC |
| unnowataru/streamdeck-ai-agent-monitor | 1 | TypeScript | 2026-03-09 | Rate-limit headroom across Claude + xAI + Codex on dials |
| caseycapshaw/streamdeck-claude-code | 1 | Python | 2026-02-22 | Icon pack + Python config generator for Ghostty/Terminal |
| tonyofthehills/agent-deck | 1 | Swift | 2026-01-15 | Swift menubar app + React Native mobile client |
| lhaig/shelly-status-light | 1 | Go | 2026-02-20 | Smart bulb availability indicator + Claude Code MCP server |

### 1.2 Niche / Lightweight Entries

| Repo                                | Stars | Lang       | Core Concept                                                                        |
| :---------------------------------- | ----: | :--------- | :---------------------------------------------------------------------------------- |
| alt-core/cc-streamdeck              |     0 | Python     | hidapi direct (no Elgato app), risk-level coloring, multi-instance, AskUserQuestion |
| keiya/stream-deck-claude-code       |     0 | TypeScript | Stream Deck+ status monitor, iTerm2 tab switching, state persistence                |
| chfields/GhostyThemeStreamDeck      |     0 | TypeScript | Ghostty terminal focus by Claude state, window priority                             |
| sohumsuthar/stream-deck-mcp         |     0 | TypeScript | Inverse architecture: Claude controls the Stream Deck via MCP                       |
| fortunto2/streamdeck-claude         |     0 | Python     | Unrelated — general dashboard built *with* Claude, not an AI control surface        |
| script-repo/Claude-StreamDeck       |     0 | —          | Empty repository                                                                    |
| jonwraymond/claude-code-stream-deck |     0 | —          | Stub only (3 files, GPL-3.0)                                                        |

---

## 2. Decky Feature Baseline

The following is the agreed feature set as of this review date, drawn from the README and source:

**Core workflow:** Approve / Deny / Stop / Restart slots driven by a state machine (idle → thinking → awaiting-approval → tool-executing → stopped) via Claude Code hooks (PreToolUse, PostToolUse, Notification, Stop, SubagentStop, PermissionRequest).

**Command injection:** Clipboard + paste to five target apps — Claude, Codex CLI, ChatGPT, Cursor, Windsurf — with optional auto-submit, per-slot target override, and focus-restore.

**Approval mechanics:** Queue with pending count, timeout (5-300 s, default 30 s), Approve Once (in-app button click via AppleScript or .NET UIA), dismissal automation.

**Voice:** Talk to Claude (macOS dictation only).

**Display / themes:** 8 slot types, 13 built-in themes, per-slot and global color overrides, icon picker, font-size control.

**Widgets:** Bridge status widget with on-click or timed refresh.

**Config:** Atomic save with 10 rotating backups, full validation (label, text, timeout, font bounds), REST API endpoints for read/write/backup/restore.

**Security:** Bearer token on all HTTP and Socket.io endpoints, CORS restricted to localhost, bind to 127.0.0.1, redacted logging, rate limits per endpoint.

**Platforms:** macOS (tested), Windows (experimental), Linux X11 (experimental). Wayland not supported.

**Test coverage:** 198 bridge tests + 102 plugin unit tests + Playwright PI tests.

---

## 3. Competitive Deep-Dives

### 3.1 AgentDeck (puritysb) — Closest Full-Featured Rival

AgentDeck is the most architecturally ambitious project in the field. Its key differentiators are:

**PTY proxy architecture.** Instead of injecting text into a running app window, AgentDeck spawns Claude Code inside a PTY subprocess (`sdc` CLI), parsing its stdout directly. This eliminates the window-switching and clipboard side-effects that affect Decky's command injection. It also means the bridge works even when the terminal is backgrounded. The trade-off is that the user interacts with Claude through the proxy rather than a native terminal session, and the setup is more tightly coupled to a single tool (Claude Code CLI only).

**Offline voice transcription.** AgentDeck uses whisper.cpp with Metal GPU acceleration on Apple Silicon, providing fully local speech-to-text with no cloud round-trip. Decky uses macOS system dictation which routes audio through Apple's infrastructure and is not available on Windows or Linux.

**Android companion app.** A Jetpack Compose app with two rendering modes — 60 fps color terrarium on tablets and partial-refresh pixel art on e-ink readers — provides a remote monitoring surface connected via mDNS/WebSocket. This is a uniquely differentiated capability with no equivalent in any other project reviewed.

**Stream Deck+ encoder LCDs.** AgentDeck is designed specifically for the Stream Deck+ hardware (4 rotary encoders with LCD displays). The encoder LCDs show ghost text, usage dashboards, scrolling option lists, and live transcription. Decky targets generic Stream Deck models and does not expose encoder-specific features.

**Rate-limit dashboard.** AgentDeck tracks 5-hour and 7-day Claude usage rate limits and displays them as an animated dashboard. Decky has no usage visibility.

**Agent mode switching.** One-button toggle between Claude Code's Plan / Accept Edits / Default modes. Decky has no mode-switching.

**Weaknesses vs. Decky.** macOS 14+ only (no Windows, no Linux). Tighter coupling to iTerm2 for session management. Security model auto-trusts local connections with no token. No backup/restore. No config validation comparable to Decky's. Fewer themes.

### 3.2 TerminalDeck (sidmohan0) — Native Architecture Pioneer

TerminalDeck is notable for its technology choice: a native macOS application built with Tauri v2 (Rust backend + React 19 frontend) communicating with the Stream Deck via HID API directly. This avoids the Node.js runtime dependency and the Elgato Stream Deck software requirement.

**Terminal management.** Opens, switches, and closes terminal windows without keyboard input — a workflow capability Decky has no equivalent to. Users can launch Claude, create terminal tabs, and navigate history entirely from hardware keys.

**Codex CLI support.** Codex is a configurable target alongside Claude. Decky already supports Codex via command injection.

**Weakness.** Limited to Stream Deck MK.2 (15-key). Focused on terminal management rather than approval workflows. No hook integration means it cannot respond to tool-use state changes. Last updated January 2026 and appears to have limited ongoing development.

### 3.3 cc-streamdeck (alt-core) — Linux-Native Risk-Aware Approver

cc-streamdeck takes a different approach to platform support: it uses the `hidapi` library to communicate with Stream Deck hardware directly, bypassing the Elgato desktop application entirely. This is the only implementation in the survey that works on Linux without the Elgato app.

**Risk-level color coding.** Operations are classified as critical, high, medium, or low risk based on configurable bash command patterns. The approval button's color reflects the risk level of the specific tool invocation. Decky shows the tool name but applies no risk differentiation.

**AskUserQuestion support.** Decky does not handle Claude Code's AskUserQuestion tool (where the assistant presents multiple-choice options to the user). cc-streamdeck routes these to the Stream Deck with multi-page navigation, enabling fully hardware-based responses to Claude's questionnaires.

**Multi-instance support.** Multiple simultaneous Claude Code sessions are tracked with a 10-color palette. Decky's approval queue handles sequential requests but does not distinguish between parallel sessions from different projects.

**Unix socket IPC.** A daemon process owns the hardware connection; hook clients communicate via Unix socket. This is more robust than Decky's HTTP+Socket.io when the Elgato app is not involved.

**"Always Allow" permanent approval.** In addition to Approve / Deny, cc-streamdeck supports a permanent allow action for a tool — analogous to "Trust this tool." Decky has no equivalent.

**Weaknesses.** Python-only, no official Elgato SDK, limited visual customization (no themes), no config backup/restore, no auth on the daemon socket.

### 3.4 keiya/stream-deck-claude-code — State Persistence and Session Switching

This TypeScript plugin is built specifically for the Stream Deck+ and integrates with iTerm2 via its Python API to map Claude Code sessions to physical slots. Its most notable design choice is treating session acknowledgment as a first-class state: once a session completes (green "done" state), idle signals are suppressed until the user presses the slot or a new prompt arrives. This prevents the display from silently resetting after task completion, ensuring the user explicitly acknowledges finished work.

The buffering mechanism for unresolved sessions (up to 30 seconds with fallback slot derivation) and atomic tab-reorder handling make this a robust multi-session monitor. Decky's approval queue manages sequential requests but does not track multiple concurrent sessions mapped to specific slots.

### 3.5 streamdeck-ai-agent-monitor (unnowataru) — Multi-Provider Rate Monitoring

The only project dedicated to cross-provider quota visibility. It monitors Claude (token rate-limit percentage and reset time from Anthropic API response headers), xAI (prepaid balance in USD), and Codex (5-hour rolling message quota). The Stream Deck+ dials cycle between providers; the touch strip triggers an immediate refresh. Color-coding transitions from green to orange to red as quota is exhausted.

Decky has no quota or usage visibility of any kind.

### 3.6 sohumsuthar/stream-deck-mcp — Inverse Architecture

This project inverts the control direction: rather than the Stream Deck controlling Claude, it is an MCP server that lets Claude control the Stream Deck. Claude can list profiles, configure buttons, assign hotkeys and URLs, change colors, and also control Elgato Key Lights and Philips Hue smart lights — all through natural language.

This is architecturally orthogonal to Decky but suggests a future integration opportunity: Decky could expose an MCP server so that Claude Code could configure its own control surface, update macro text, or acknowledge its own completion.

### 3.7 tonyofthehills/agent-deck — Mobile Monitoring Surface

A Swift native macOS menubar app that monitors Claude Code transcript files (`~/.claude/transcripts/`) via FSEvents and streams state to a React Native iOS/Android companion app over local WiFi WebSocket. The mobile app provides one-tap window switching. No Stream Deck hardware involved — the phone replaces the control surface.

This is significant as a design direction: Decky is currently hardware-gated. A future soft surface (phone app, web UI, or secondary display) would extend reach to users who do not own Stream Deck hardware.

---

## 4. Feature Gap Analysis

### 4.1 Feature Completeness Matrix

The table below scores each capability: **✅ Yes** (implemented), **⚠️ Partial** (present but limited), **❌ No** (absent).

| Capability | Decky | AgentDeck | TerminalDeck | cc-streamdeck | keiya | unnowataru |
|:-----------|:-----:|:---------:|:------------:|:-------------:|:-----:|:----------:|
| Approve / Deny / Stop | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approval queue | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Approval timeout | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Always Allow (permanent) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| AskUserQuestion support | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Risk-level color coding | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Command injection (multi-target) | ✅ | ⚠️ Claude only | ⚠️ | ❌ | ❌ | ❌ |
| Voice input | ⚠️ macOS only | ✅ offline whisper | ✅ | ❌ | ❌ | ❌ |
| Rate limit / usage display | ❌ | ✅ 5hr+7day | ❌ | ❌ | ❌ | ✅ multi-provider |
| Multi-session monitoring | ❌ | ⚠️ | ❌ | ✅ 10-color | ✅ 8-slot | ❌ |
| Session acknowledgment state | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| iTerm2 / terminal tab switching | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Terminal window management | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mode switching (Plan/Accept/Default) | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Git branch / project display | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| State persistence across restart | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Themes + visual customization | ✅ 13 themes | ❌ | ❌ | ❌ | ❌ | ❌ |
| Config backup / restore | ✅ 10 backups | ❌ | ❌ | ❌ | ❌ | ❌ |
| Token auth on bridge | ✅ | ❌ | N/A | ❌ | ✅ | ❌ |
| Rate limits on endpoints | ✅ | ❌ | N/A | ❌ | ❌ | ❌ |
| Windows support | ⚠️ exp. | ❌ | ❌ | ❌ | ❌ | ❌ |
| Linux support | ⚠️ X11 only | ❌ | ❌ | ✅ | ❌ | ❌ |
| No Elgato app required (hidapi) | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Encoder/dial LCD support | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Android / mobile companion | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| npm / npx installer | ❌ | ✅ @agentdeck/setup | ❌ | ❌ | ❌ | ❌ |
| MCP server exposure | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Smart home / IoT integration | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Test suite depth | ✅ 300+ tests | ❌ | ❌ | ⚠️ | ⚠️ 53 tests | ⚠️ 53 tests |
| CI/CD pipeline | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ GH Actions |

### 4.2 Feature Gaps Ranked by User Impact

**Critical gaps (users actively work around these today):**

1. **AskUserQuestion hook support.** Claude Code's `AskUserQuestion` tool presents multi-choice dialogs to the user. Decky has no handling for this event type. Users must leave the Stream Deck and respond via keyboard. cc-streamdeck routes these to hardware buttons with multi-page navigation. This is a first-class workflow break.

2. **Multi-session / multi-instance monitoring.** Developers running parallel Claude Code sessions (common with tmux or multiple projects) see only the most recent approval on Decky's queue. cc-streamdeck and keiya both assign distinct physical slots per session with color or state differentiation.

3. **Rate limit visibility.** No usage display means users are surprised by 5-hour rate limit exhaustion. AgentDeck shows live 5-hour and 7-day utilization. unnowataru's monitor covers Claude + xAI + Codex. A widget slot showing current rate-limit percentage would fit naturally into Decky's widget system.

**High-impact gaps (meaningful workflow improvements):**

4. **Risk-level color coding for tool approvals.** The tool name is displayed today, but all tool requests look visually identical. Classifying operations as critical (shell commands writing to root paths), high (file deletion), medium (file write), or low (read-only) and applying color accordingly would help users make faster, more confident approval decisions. cc-streamdeck demonstrates this works well in practice.

5. **Always Allow (permanent approval).** Repeatedly approving the same low-risk tool invocation in a long session generates approval fatigue. An "Always Allow this tool" action — writing a permanent allow rule — would reduce interruptions for trusted operations. cc-streamdeck calls this the third approval option.

6. **Session acknowledgment before idle reset.** When a Claude Code task finishes, the Stream Deck should hold in a "Done" state until the user explicitly acknowledges it (by pressing the key or sending a new prompt). keiya's block on `done → idle` without acknowledgment prevents the display from silently resetting and losing visibility of completed work.

7. **Offline voice transcription via whisper.cpp.** Decky's voice input uses macOS system dictation, which is unavailable on Windows and Linux and routes audio off-device. Local whisper.cpp transcription via Metal (macOS) or CUDA (Linux) would give cross-platform parity and privacy. AgentDeck ships this today.

8. **Stream Deck+ encoder LCD support.** Many users own Stream Deck+ hardware. Decky presents no content on the encoder LCDs. Minimal support — current tool name, pending approval count, or rate-limit percentage on the touch strip — would make better use of the hardware.

**Medium-impact gaps (polish and reach):**

9. **Terminal / iTerm2 tab switching on button press.** When an approval arrives, TerminalDeck, cc-streamdeck, keiya, and AgentDeck all switch focus to the originating terminal. Decky switches focus to the target app for `popUpApp` but does not navigate to the specific terminal session where the approval originated.

10. **npx installer / published npm package.** AgentDeck ships `@agentdeck/setup` — users run `npx @agentdeck/setup` and nothing else. Decky requires cloning the repo and running `./install.sh`. Lowering the installation barrier is a direct adoption driver.

11. **State persistence across bridge restarts.** Decky resets to idle when the bridge restarts. keiya persists state to `~/.cache/claude-status/state.json` so that active session slots survive restarts. This matters in long-running development sessions.

12. **Agent mode switching.** A one-button toggle for Claude Code's `--plan` / `--accept-edits` / default modes would fit naturally as a command slot. AgentDeck treats this as a core quick action.

**Niche / future-looking:**

13. **MCP server exposure.** An MCP tool surface that lets Claude Code configure its own control panel (update macro text, query available slots, acknowledge its own completion) aligns with the industry direction shown by sohumsuthar's stream-deck-mcp. This is a novel capability no other project has applied to the approval-workflow problem.

14. **Mobile / soft surface companion.** A local-WiFi WebSocket companion (phone web app or React Native) would extend Decky to users without Stream Deck hardware and to use cases where carrying the hardware is impractical. agent-deck (tonyofthehills) demonstrates the architecture.

15. **Linux without Elgato app (hidapi).** cc-streamdeck and TerminalDeck both bypass the Elgato desktop app entirely using `hidapi`. Decky's Linux support is experimental and gated on the unofficial Elgato SDK community port. A hidapi fallback path would give Decky genuine Linux support.

---

## 5. Security Gap Analysis

Decky has the strongest security posture of any project in the survey. The gaps identified are incremental hardening, not fundamental weaknesses.

| Security Property | Decky | Field Average |
|:-----------------|:------|:--------------|
| Bearer token auth | ✅ Required on all endpoints | Most have no auth |
| CORS restricted to localhost | ✅ | Rare |
| TCP bind to 127.0.0.1 | ✅ | Mixed (0.0.0.0 common) |
| Redacted logging | ✅ `redactActionForLog()` | Not present elsewhere |
| Endpoint rate limiting | ✅ | Not present elsewhere |
| Config input validation | ✅ Comprehensive | Not present elsewhere |
| Atomic config saves + backup | ✅ 10-rotation backup | Not present elsewhere |
| Nonce on hook scripts | ✅ fail-closed on mismatch | Only Decky |
| Token rotation on restart | ❌ Token persists indefinitely | N/A |
| Unix domain socket option | ❌ TCP only | cc-streamdeck uses Unix socket |
| Per-request HMAC | ❌ Static bearer token | N/A |
| CI dependency scanning | ❌ | rare — unnowataru has GH Actions |

**Outstanding security items from the existing security review:**

- **Token rotation (P2):** The bridge token never rotates. Any same-user process that reads `~/.decky/bridge-token` retains permanent bridge access. Rotating on each bridge start (cheap, backward compatible with hook scripts that re-read from file) limits the blast radius of a token leak.

- **Unix domain socket (P3):** Replacing TCP port 9130 with `~/.decky/bridge.sock` (mode 0o600) would eliminate the need for token auth on local connections while improving posture. OS permissions replace application-level auth. This also resolves the localhost TCP sniffing surface, however theoretical.

- **CI dependency scanning (P3):** No competitor ships CI, but Decky's 300-test suite makes automated dependency auditing straightforward to add via `npm audit` in GitHub Actions.

---

## 6. Platform Gap Analysis

| Platform | Decky | AgentDeck | TerminalDeck | cc-streamdeck |
|:---------|:------|:----------|:-------------|:--------------|
| macOS (tested) | ✅ Full | ✅ macOS 14+ | ✅ macOS 12+ | ✅ macOS |
| Windows | ⚠️ Experimental | ❌ | ❌ | ❌ |
| Linux X11 | ⚠️ Experimental | ❌ | ❌ | ✅ |
| Linux Wayland | ❌ | ❌ | ❌ | ❌ |
| Stream Deck MK.2 (15-key) | ✅ | ✅ | ✅ | ✅ |
| Stream Deck+ (encoders+LCD) | ⚠️ Keys only | ✅ Full | ❌ | ⚠️ |
| Stream Deck Mini | ✅ | ✅ | ❌ | ✅ |
| Stream Deck XL | ✅ | ✅ | ❌ | ✅ |
| Android | ❌ | ✅ | ❌ | ❌ |
| iOS/Mobile | ❌ | ❌ | ❌ | ❌ |
| No Elgato app (hidapi) | ❌ | ❌ | ✅ | ✅ |

**Key platform findings:**

Decky has the broadest hardware model support (any Stream Deck via Elgato SDK) and the best Windows story of any competitor. Its experimental Linux support is real but fragile, gated on an unofficial Elgato SDK community port that does not have a stable release schedule.

Linux without Elgato app is a meaningful gap. cc-streamdeck shows hidapi is viable for this use case and serves a dedicated Linux developer segment.

Wayland is a hard problem: the security model blocks cross-application keystroke injection and window activation. No project in the survey has solved Wayland support. The path forward is either a Wayland-native compositor extension or a terminal-specific protocol (e.g., a named pipe into a running shell).

Stream Deck+ encoder LCDs represent an underexploited hardware surface. Adding even minimal encoder feedback (approval count on the touch strip, rate limit % on a dial) would differentiate Decky on the increasingly common Stream Deck+ hardware.

---

## 7. AI Provider Gap Analysis

| Provider | Hook Integration | Command Injection | Approval Automation | Rate Limit Display |
|:---------|:----------------:|:-----------------:|:-------------------:|:-----------------:|
| Claude Code | ✅ | ✅ | ✅ | ❌ |
| Codex CLI | ⚠️ Via Claude hooks | ✅ | ✅ (as Codex) | ❌ |
| ChatGPT Desktop | ❌ No hooks | ✅ | ❌ | ❌ |
| Cursor | ❌ No hooks | ✅ | ✅ (as Codex) | ❌ |
| Windsurf | ❌ No hooks | ✅ | ❌ | ❌ |
| Gemini CLI | ❌ | ❌ | ❌ | ❌ |
| xAI / Grok | ❌ | ❌ | ❌ | ❌ |
| Amp CLI | ❌ | ❌ | ❌ | ❌ |

**Findings:**

Decky's command injection already reaches five targets. The gap is hook-driven state management for non-Claude agents. Codex hooks are handled by re-using Claude Code's hook mechanism (Codex subscribes to the same hook events). Cursor and Windsurf would need their own hook plumbing.

The most actionable near-term provider gap is **rate limit display for Claude**. The data is available in Anthropic API response headers (`x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens`). Decky's bridge receives every hook payload and could track this without any new external calls.

Looking further out, **Gemini CLI** has emerged as a significant player with its own hook-like event system. Amp CLI (a new entrant) also uses an approval-style model. Neither is supported by any project in this survey, presenting an early-mover opportunity.

---

## 8. Technology Assessment

### 8.1 Architecture Comparison

| Architecture | Projects | Pros | Cons |
|:-------------|:---------|:-----|:-----|
| Plugin + HTTP bridge (Decky's model) | Decky, etechlead, keiya, unnowataru | Clean separation; Elgato SDK features; proven | Node.js startup; Elgato app required |
| PTY proxy (transparent subprocess) | AgentDeck | Deep integration; background-safe; no window switching | Tightly coupled to terminal; complex setup |
| hidapi direct | cc-streamdeck, TerminalDeck | No Elgato app; Linux support | No SDK features; hardware-specific |
| Native macOS app | TerminalDeck (Tauri), agent-deck (Swift) | Low resource use; better UX | Platform-locked; heavier engineering |
| File-based IPC | joachimschmidt | Simple to implement | No concurrent access, no queue, world-readable /tmp |
| Unix socket + daemon | cc-streamdeck | OS-level access control; robust | Daemon lifecycle management |
| MCP server | sohumsuthar | Natively Claude-aware; composable | Inverse direction; depends on Claude running |

Decky's plugin + HTTP bridge model is the right long-term architecture. The Elgato SDK v2 provides rendering, property inspector, and update distribution capabilities that hidapi approaches cannot match. The main engineering debt is the lack of a first-class Linux path.

### 8.2 Inter-Process Communication Survey

| IPC Mechanism | Security | Reliability | Latency | Used by |
|:--------------|:--------:|:-----------:|:-------:|:--------|
| HTTP + Socket.io | Token auth | High | Low | Decky |
| WebSocket (raw) | Auto-trust | High | Low | AgentDeck, agent-deck |
| Unix socket | OS permissions | High | Very Low | cc-streamdeck |
| /tmp file polling | None | Medium | Medium | joachimschmidt |
| HID protocol | Physical | High | Very Low | TerminalDeck, cc-streamdeck |
| MCP protocol | Per-server | High | Low | sohumsuthar |

Decky's IPC is the most secure in the field. The /tmp file approach used by joachimschmidt is a significant regression — concurrent access, race conditions, and world-readability are all real problems at scale.

### 8.3 Installer / Distribution Quality

| Project | Install Method | DX Quality |
|:--------|:---------------|:----------|
| AgentDeck | `npx @agentdeck/setup` | ⭐⭐⭐⭐⭐ |
| Decky | `git clone && ./install.sh` | ⭐⭐⭐ |
| cc-streamdeck | `uv pip install` | ⭐⭐⭐ |
| TerminalDeck | Native app build (Rust required) | ⭐⭐ |
| caseycapshaw | Python script, manual SD configuration | ⭐⭐ |
| joachimschmidt | npm + manual hook setup | ⭐⭐ |

AgentDeck's `npx @agentdeck/setup` is a strong differentiator: zero prior setup, works on any machine with Node.js, handles all dependency checks and plugin linking in one command. Decky's `./install.sh` is competent but requires the user to clone the repo first. Publishing `@decky/setup` to npm would match this and make Decky more shareable.

---

## 9. Prioritized Feature and Technology Roadmap

The following roadmap prioritizes features by: user impact, implementation complexity, competitive differentiation, and fit within Decky's existing architecture.

### Tier 1 — High Impact, Low Complexity (Next Sprint)

**T1-1: AskUserQuestion hook support**
Handle Claude Code's `AskUserQuestion` event type. Map the presented options to command slots, show each option as a labeled button, and write the selection back via the hook response mechanism. Decky's slot system and approval-gate architecture already support this pattern.
*Estimated complexity: Medium. Reference: cc-streamdeck.*

**T1-2: Rate limit widget slot**
Add a new widget type showing current Claude Code 5-hour rate-limit percentage. Parse `x-ratelimit-remaining-tokens` and `x-ratelimit-reset-tokens` from hook payloads (or poll `/status`). Display as percentage + reset time on a widget slot. Extend to show dollar/token usage for xAI and Codex when those providers are active.
*Estimated complexity: Low-Medium. Reference: unnowataru/streamdeck-ai-agent-monitor.*

**T1-3: Session acknowledgment (done → idle guard)**
Block the state machine's transition from `done` back to `idle` until the user explicitly presses the done slot or a new prompt arrives. This prevents silent idle-resets after long tasks and gives the user a moment to review what was accomplished.
*Estimated complexity: Low. Reference: keiya/stream-deck-claude-code.*

**T1-4: Risk-level color coding for approvals**
Classify tool invocations by risk tier (critical, high, medium, low) using a configurable pattern table in config.json. Apply a distinct background color to the Approve slot when an approval arrives, overriding the theme default for that request. The risk tier should be shown in the slot label alongside the tool name.
*Estimated complexity: Low-Medium. Reference: cc-streamdeck.*

### Tier 2 — High Impact, Medium Complexity (Next Quarter)

**T2-1: Always Allow (permanent approval) slot type**
Add a fourth approval action — "Always Allow" — that writes a permanent allow rule for the requesting tool to config and responds with approval. Future requests from the same tool skip the approval UI entirely unless the rule is revoked. Requires a rule-management UI in the Property Inspector.
*Estimated complexity: Medium. Reference: cc-streamdeck.*

**T2-2: Multi-session monitoring (parallel Claude instances)**
Track multiple concurrent Claude Code sessions. Assign each session to a fixed slot number (user-configured). Show per-session state with distinct color coding. Queue-overflow sessions fall back to the global queue. This requires the hook scripts to pass a session identifier and the bridge to maintain per-session state.
*Estimated complexity: Medium-High. Reference: cc-streamdeck, keiya.*

**T2-3: npm package installer (@decky/setup)**
Publish a `@decky/setup` npm package. `npx @decky/setup` should handle dependency checking, npm install, build, hook installation, and plugin linking — eliminating the need to clone the repository. This directly reduces the installation barrier that is the primary adoption obstacle vs. AgentDeck.
*Estimated complexity: Low. This is a packaging task.*

**T2-4: Stream Deck+ encoder LCD support**
Implement minimal encoder content: touch strip shows pending approval count (color-coded by risk); dial press cycles through queued approvals; dial LCD shows the current tool name and session context. Full encoder support (ghost text, usage graphs) is a stretch goal. Use the Elgato SDK's `setFeedback` API.
*Estimated complexity: Medium. Reference: AgentDeck, keiya.*

**T2-5: Token rotation on bridge start**
Rotate the bridge token on each start. Hook scripts already re-read the token file on each invocation. The plugin re-reads on reconnect. This is a low-cost security improvement that limits the blast radius of token leaks without changing the operational model.
*Estimated complexity: Low.*

### Tier 3 — Medium Impact, Higher Complexity (Next Half)

**T3-1: Terminal tab switching on approval events**
When an approval arrives, identify the terminal session (iTerm2 tab, tmux pane, or WezTerm window) from which the Claude Code instance is running and switch focus to it. This requires the hook scripts to capture terminal session context (`ITERM_SESSION_ID`, tmux `$TMUX_PANE`, etc.) and pass it through the bridge.
*Estimated complexity: Medium-High. Reference: cc-streamdeck, keiya, AgentDeck.*

**T3-2: State persistence across bridge restarts**
Serialize the state machine's current state (including active session slots and pending approvals) to `~/.decky/state.json` on shutdown and restore on startup. Sessions that were in `awaiting-approval` at shutdown should restore to that state with a stale-approval warning.
*Estimated complexity: Medium. Reference: keiya.*

**T3-3: Offline voice transcription (whisper.cpp)**
Replace the macOS-dictation-only Talk to Claude slot with a whisper.cpp-based local transcription path. On macOS, use Metal acceleration. On Linux, use CPU (CUDA if detected). This makes voice input cross-platform and removes cloud audio routing. Ship as optional (falls back to system dictation if whisper.cpp not installed).
*Estimated complexity: High. Reference: AgentDeck.*

**T3-4: Agent mode switching (Plan / Accept Edits / Default)**
Add a Mode slot type that toggles Claude Code between `--plan`, `--accept-edits`, and default modes via command injection. Requires detecting the current mode from Claude Code's state output and displaying it on the key. Can be implemented as a Command slot variant with a mode-aware label.
*Estimated complexity: Medium. Reference: AgentDeck.*

**T3-5: CI/CD pipeline**
Add GitHub Actions: lint, typecheck, test (bridge + plugin), npm audit, and build-artifact publishing. Tie the `@decky/setup` npm package release to tagged builds.
*Estimated complexity: Low. Reference: unnowataru.*

### Tier 4 — Strategic / Exploratory (Long Horizon)

**T4-1: Linux hidapi fallback path**
Implement a hidapi-based plugin host for Linux (and potentially macOS/Windows as a secondary path) that bypasses the Elgato desktop app dependency. This unblocks genuine Linux support and is the only viable Wayland path (hidapi does not require window management APIs). High engineering effort; high strategic value for the Linux developer segment.
*Reference: cc-streamdeck, TerminalDeck.*

**T4-2: MCP server interface**
Expose a subset of the Decky bridge REST API as an MCP server. This would allow Claude Code to: read its current approval queue, update macro text programmatically, mark its own task as complete, or query available slot configuration. Architecturally novel — no competitor has applied the MCP pattern to the control-surface problem.
*Reference: sohumsuthar/stream-deck-mcp.*

**T4-3: Mobile / web soft surface**
A local-WiFi companion (lightweight web app or React Native) that mirrors the Stream Deck layout and relays button presses to the bridge. This extends Decky to users without Stream Deck hardware. The bridge already exposes a Socket.io interface; a web client requires only a React frontend consuming existing events.
*Reference: agent-deck (tonyofthehills), AgentDeck Android.*

**T4-4: Gemini CLI / Amp CLI provider support**
Add hook integration for Gemini CLI (Google) and Amp CLI as they mature. Both use approval-style permission models. Being the first control surface to support them while the ecosystems are forming is a low-cost differentiator.

**T4-5: Unix domain socket bridge mode**
Add an optional `DECKY_SOCKET` mode that replaces the TCP port with a Unix domain socket at `~/.decky/bridge.sock` (mode 0o600). OS filesystem permissions replace application-level token auth for local connections. Reduces attack surface for same-user local-process threats.
*Reference: cc-streamdeck security model, existing security-review.md T4-5.*

---

## 10. Summary Recommendation

Decky is the most complete, best-tested, and most secure project in this space. Its lead over competitors on config safety, theme richness, cross-platform command injection, and test coverage is substantial. The projects that most challenge it — AgentDeck (24★) and TerminalDeck (22★) — each have compelling differentiators (PTY proxy + Android companion, and native Tauri app respectively) but lack Decky's depth of platform coverage, security posture, and feature breadth.

The competitive pressure is real and accelerating. AgentDeck was updated 21 hours before this analysis was written and appears to be under active development by a skilled team. It is the primary reference competitor.

**The five actions most likely to strengthen Decky's position in the next 90 days:**

1. **Ship AskUserQuestion support** — closes the most visible workflow gap and matches a feature cc-streamdeck already ships. It is the one capability that forces users to leave the Stream Deck entirely.

2. **Publish `@decky/setup` to npm** — closes the installation gap with AgentDeck in a single afternoon's work. Distribution quality directly drives adoption.

3. **Add a rate-limit widget** — makes Decky aware of the Claude 5-hour limit before users hit it, converting a common frustration into a Decky-exclusive feature.

4. **Implement risk-level color coding on approvals** — the most visible UX improvement to the core approval workflow, requiring only a pattern table and a color override on the Approve slot.

5. **Add the done → idle acknowledgment gate** — a small state machine change that substantially improves the experience for long-running tasks.

Items 2, 3, and 5 are each one to two days of work. Items 1 and 4 are week-scale features. Together they close the most-cited competitive gaps while playing to Decky's existing strengths.
