# Porting Decky to Windows and Linux

Fresh analysis based on the codebase as of 2026-03-10.

## How Decky Works (Portability Context)

Decky has three runtime layers and a set of hook scripts. Each layer has a
different portability profile:

1. **Plugin** (`plugin/`) — runs inside the StreamDeck host app. Communicates
   with the bridge over Socket.io. Renders SVG icons. Entirely JavaScript/TS
   with no OS-specific code. Fully portable once the manifest allows it.

2. **Property Inspector** (`plugin/com.decky.controller.sdPlugin/ui/`) — an
   HTML page loaded inside the StreamDeck desktop app. Pure DOM/JS/CSS. Fully
   portable.

3. **Bridge** (`bridge/`) — a Node.js + Express + Socket.io server running
   locally. Core server logic (state machine, config management, HTTP routes,
   Socket.io) is portable. Macro execution and some file-system operations are
   macOS-specific.

4. **Hook scripts** (`hooks/`) — Bash shell scripts invoked by Claude Code
   before/after tool use. They POST JSON to the bridge via curl and (in gate
   mode) poll a file. Bash + curl dependency; macOS `stat` flags.

## File-by-File Assessment

### Fully Portable (no changes needed)

| File(s) | Why |
|---------|-----|
| `plugin/src/**` (all plugin source) | Socket.io client, SVG rendering, StreamDeck SDK v2 JS API. No `child_process`, no `process.platform`, no OS calls. |
| `plugin/com.decky.controller.sdPlugin/ui/**` | HTML/CSS/JS Property Inspector. DOM only. |
| `bridge/src/state-machine.ts` | Pure state logic, no I/O. |
| `bridge/src/app.ts` | Express + Socket.io routing. All I/O goes through other modules. |
| `bridge/src/server.ts` | Binds HTTP port. No OS dependency. |
| `bridge/src/approval-trace.ts` | In-memory log. No OS dependency. |
| `plugin/scripts/generate-icons.mjs` | Node.js Canvas-free SVG→PNG. Uses `sharp` which has prebuilt binaries for all three platforms. |

### Minor Fixes Required

#### `bridge/src/config.ts` — editor allowlist is macOS-biased

The `ALLOWED_EDITORS` list is `["bbedit", "code", "cursor", "windsurf", "textedit"]`.
BBEdit and TextEdit are macOS-only. The `DEFAULT_EDITOR` is `bbedit`.

**Fix:** Add platform-appropriate editors (e.g. `notepad` on Windows, `gedit`/
`xdg-open` on Linux). Change the default editor per-platform, or fall back to
a universal choice like `code` (VS Code).

**Effort:** Trivial — a few lines of platform detection.

#### `bridge/src/approval-gate.ts` — Unix file permissions, atomic rename

- `mkdirSync(..., { mode: 0o700 })` and `writeFileSync(..., { mode: 0o600 })`:
  Unix mode bits are silently ignored on Windows. The security intent
  (owner-only access) is not enforced.
- `renameSync(tmp, GATE_FILE)`: On Windows, `renameSync` throws `EPERM` if the
  destination file already exists (unlike POSIX where it atomically replaces).

**Fix:** On Windows, wrap `renameSync` in a try/catch that does
`unlinkSync(dest)` then retries. For permissions, either accept the lower
security bar on Windows or use Windows ACLs via a helper.

**Effort:** Small — 10-20 lines of platform branching.

#### `bridge/src/security.ts` — Unix file permissions

Same `mode: 0o700` / `mode: 0o600` pattern for the token directory and file.
Silently ignored on Windows.

**Fix:** Same as approval-gate — accept or implement Windows ACL equivalent.

**Effort:** Trivial.

#### `bridge/src/config.ts` — atomic write uses `renameSync`

`writeConfigAtomically()` uses `renameSync(tmp, CONFIG_PATH)` which has the
same EPERM risk on Windows.

**Fix:** Same unlink-then-rename pattern.

**Effort:** Trivial.

#### `plugin/com.decky.controller.sdPlugin/manifest.json` — macOS-only

Currently declares:
```json
"OS": [{ "Platform": "mac", "MinimumVersion": "13" }]
```

This actively blocks the plugin from loading on Windows or Linux.

**Fix:** Add Windows and Linux entries:
```json
"OS": [
  { "Platform": "mac", "MinimumVersion": "13" },
  { "Platform": "windows", "MinimumVersion": "10" },
  { "Platform": "linux" }
]
```

**Effort:** One-line change. Note: Linux support in Stream Deck is limited —
Elgato does not ship an official Linux host. Community tools exist but are
not guaranteed to honour the same manifest schema.

#### `.github/workflows/plugin-pi-tests.yml` — Linux-only CI

Runs `ubuntu-latest` only. No macOS or Windows runners.

**Fix:** Add a matrix strategy with macOS and Windows runners for bridge tests.
Plugin/PI tests (Playwright, vitest) are platform-independent and can stay
Linux-only.

**Effort:** Small workflow edit.

### Major Work Required

#### `bridge/src/macro-exec.ts` — entirely macOS-specific (691 lines)

This is the deepest portability blocker. Every function in this file uses macOS
APIs with no abstraction layer:

| Capability | macOS mechanism | Used by |
|------------|----------------|---------|
| Copy to clipboard | `pbcopy` via `execFile` | `executeMacro()` |
| Activate app | AppleScript `tell application ... to activate` with bundle IDs | `executeMacro()`, `surfaceTargetApp()`, `approveInTargetApp()` |
| Simulate keystrokes | AppleScript `System Events` `keystroke` / `key code` | `executeMacro()`, `approveInTargetApp()`, `dismissApprovalInTargetApp()` |
| Paste via menu | AppleScript `click menu item "Paste" of menu "Edit"` | `executeMacro()` (Electron apps) |
| Click approval buttons | AppleScript accessibility: find and click buttons by label/subrole in app windows | `approveInTargetApp()`, `dismissApprovalInTargetApp()` |
| Capture frontmost app | AppleScript `System Events` → bundle ID, process name, window name | `getFrontmostSnapshot()` |
| Restore focus | AppleScript `AXRaise` + `set frontmost` | `buildRestoreFragment()` |
| Start dictation | AppleScript `click menu item "Start Dictation…"` | `startDictationForClaude()` |
| App identification | macOS bundle IDs (`com.anthropic.claudefordesktop`, etc.) | `TARGET_APP_SPECS` |

**Affected button types:**
- **Command buttons** (any macro with `text`): clipboard + activate + paste + submit + restore
- **Approve Once** (`approveOnceInClaude`/`approveInTargetApp`): activate + click button or keystroke Return
- **Dismiss** (`dismissClaudeApproval`/`dismissApprovalInTargetApp`): activate + Escape/Cmd+dot or click button
- **Talk to Claude** (`startDictationForClaude`): activate + click Edit→Start Dictation menu
- **Surface App** (`surfaceTargetApp`): activate app (used when popUpApp is enabled)

**Windows equivalents:**

| Capability | Windows mechanism |
|------------|-------------------|
| Clipboard | `clip.exe` or PowerShell `Set-Clipboard` |
| Activate app | PowerShell/Win32 `SetForegroundWindow` by window title or class |
| Keystrokes | `SendKeys` via PowerShell, or native module (`@nut-tree/nut-js`) |
| Click buttons | UI Automation API via PowerShell or native module |
| App identification | Window title / executable name (no bundle IDs) |
| Dictation | No direct equivalent; platform speech-to-text varies |

**Linux equivalents:**

| Capability | Linux mechanism |
|------------|----------------|
| Clipboard | `xclip`/`xsel` (X11), `wl-copy` (Wayland) |
| Activate app | `xdotool windowactivate` (X11), `gdbus` / D-Bus (Wayland, unreliable) |
| Keystrokes | `xdotool key` (X11), `ydotool` (Wayland, requires root or uinput) |
| Click buttons | `xdotool`/AT-SPI (X11), limited on Wayland |
| App identification | `WM_CLASS` (X11), varies on Wayland |
| Dictation | No standard API |

**Effort:** High. This is essentially three parallel implementations behind a
platform abstraction. Each platform also needs its own app-identification
mapping (bundle IDs → window titles → WM_CLASS values).

#### `hooks/*.sh` — Bash-only, macOS stat flags

All four hook scripts share the same pattern:
- `#!/usr/bin/env bash` — not available on native Windows (requires WSL, Git Bash, or Cygwin)
- `curl` — not a Windows baseline tool
- `tr`, `head`, `cat`, `rm`, `mkdir -p` — require a Unix-like environment on Windows

`pre-tool-use.sh` has additional issues:
- `LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 24` — `/dev/urandom` does not exist on native Windows
- `stat -f '%u' / stat -f '%OLp'` — macOS `stat` syntax. GNU/Linux stat uses `-c '%u'` / `-c '%a'`. Windows has no `stat` equivalent.
- `sleep 0.2` — sub-second sleep requires GNU coreutils on Linux (works on macOS)

**Fix options:**
1. **Rewrite hooks in Node.js** — a single cross-platform implementation.
   Claude Code invokes `node ~/.decky/hooks/pre-tool-use.js` etc. Node has
   native `crypto.randomBytes`, `fs.statSync`, `fetch`/`http`, and works
   identically on all platforms. This is the recommended approach.
2. **Ship PowerShell scripts alongside Bash** — doubles maintenance surface.
3. **Require WSL/Git Bash on Windows** — poor UX, not recommended.

**Effort:** Medium (for the Node.js rewrite). The scripts are short (25-125 lines each)
and the logic is straightforward HTTP+file I/O.

## Feature Portability Matrix

| Feature | macOS | Windows | Linux (X11) | Linux (Wayland) |
|---------|-------|---------|-------------|-----------------|
| Bridge server | ✅ | ✅ (minor fixes) | ✅ (minor fixes) | ✅ (minor fixes) |
| Plugin load + PI | ✅ | ✅ (manifest edit) | ⚠️ no official host | ⚠️ no official host |
| Approval workflow (approve/deny/cancel via StreamDeck) | ✅ | ✅ (after hook rewrite) | ✅ (after hook rewrite) | ✅ (after hook rewrite) |
| State display + widget | ✅ | ✅ | ✅ | ✅ |
| Config editing via PI | ✅ | ✅ | ✅ | ✅ |
| Command buttons (text injection) | ✅ | ❌ needs new backend | ❌ needs new backend | ❌ needs new backend |
| Approve Once (click button in app) | ✅ | ❌ needs UI automation | ❌ needs UI automation | ❌ very hard |
| Surface App (pop up target) | ✅ | ❌ needs window API | ❌ needs xdotool | ❌ unreliable |
| Talk to Claude (dictation) | ✅ | ❌ no equivalent | ❌ no equivalent | ❌ no equivalent |
| Focus capture + restore | ✅ | ❌ needs Win32 API | ❌ needs xdotool | ❌ very hard |

## Recommended Phased Approach

### Phase 1: Ship Core Approval Workflow Cross-Platform

**Goal:** Approve/deny/cancel buttons, state display, config editing, and
widgets work on all platforms. Command buttons appear but show a "not supported
on this platform" error when pressed.

**Tasks:**
1. Add Windows + Linux to `manifest.json` OS array.
2. Rewrite hook scripts in Node.js (4 scripts, ~150 lines each).
3. Update `install.sh` → cross-platform Node installer.
4. Fix `renameSync` EPERM on Windows in `approval-gate.ts` and `config.ts`.
5. Make `DEFAULT_EDITOR` platform-aware in `config.ts`.
6. Add `process.platform` guard in `app.ts` around `macro-exec.ts` imports so
   unsupported actions return a structured error instead of crashing.
7. Add CI matrix (macOS + Windows + Ubuntu) for bridge tests.

**Outcome:** Decky's primary purpose (approval workflow) works on all platforms.
Users can configure command buttons but get a clear error if they try to use
text injection on a non-macOS platform.

**Effort estimate:** 3-5 days.

### Phase 2: Windows Text Injection Backend

**Goal:** Command buttons and Approve Once work on Windows.

**Tasks:**
1. Create `bridge/src/macro-exec-win32.ts` implementing clipboard + activate +
   paste + keystroke via PowerShell or `@nut-tree/nut-js`.
2. Build Windows app-identification mapping (window titles for Claude, Codex,
   ChatGPT, Cursor, Windsurf).
3. Implement `approveInTargetApp` and `dismissApprovalInTargetApp` using
   Windows UI Automation.
4. Wire platform selection in a new `bridge/src/macro-exec-router.ts` that
   delegates to the correct backend based on `process.platform`.
5. Add integration tests (can be manual or use a Windows CI runner).

**Outcome:** Full command-button parity on Windows.

**Effort estimate:** 5-8 days. UI Automation for button clicking is the hardest
part — consider shipping Approve Once as macOS-only initially and adding it to
Windows later.

### Phase 3: Linux Text Injection Backend (X11)

**Goal:** Command buttons work on Linux under X11.

**Tasks:**
1. Create `bridge/src/macro-exec-linux.ts` using `xclip` + `xdotool`.
2. Build `WM_CLASS` mapping for the five target apps.
3. Focus capture/restore via `xdotool getactivewindow` / `windowactivate`.

**Wayland caveat:** Wayland's security model deliberately prevents applications
from activating other windows or injecting keystrokes. `xdotool` does not work
under Wayland. `ydotool` requires elevated privileges. This is a fundamental
platform limitation, not a Decky limitation. Recommend documenting Wayland as
unsupported for text injection and detecting it at runtime
(`$XDG_SESSION_TYPE === "wayland"`).

**Effort estimate:** 3-5 days for X11. Wayland support is an open research
problem.

### Phase 4: Dictation and Polish

**Goal:** Address remaining macOS-only features and harden cross-platform support.

**Tasks:**
1. Decide on Talk to Claude: macOS-only, or implement platform alternatives.
2. Document platform limitations prominently in README and PI.
3. Add capability flags to bridge config snapshots so PI can hide/disable
   unsupported action types per-platform.
4. End-to-end testing across all platforms.

**Effort estimate:** 2-3 days.

## Risk Summary

| Risk | Severity | Notes |
|------|----------|-------|
| `macro-exec.ts` rewrite scope | High | 691 lines of deeply macOS-specific automation. Each platform needs different app identification, different automation APIs, different timing. |
| Wayland text injection | High | Fundamental platform limitation. No reliable solution exists. Must be documented as unsupported. |
| Linux Stream Deck host | Medium | No official Elgato host for Linux. Community tools (streamdeck-ui, etc.) may not fully implement SDK v2. |
| Windows `renameSync` EPERM | Low | Well-understood fix: unlink + rename. Affects approval-gate and config writes. |
| Hook script rewrite | Medium | Straightforward but touches the security-critical approval path. Must preserve nonce validation, timeout, fail-closed semantics. |
| Windows UI Automation fragility | Medium | Button labels and window structures can change between app versions. Approve Once on Windows may be brittle. |
| Editor allowlist | Low | Easy to extend per-platform. |

## Summary

Decky's approval workflow — its primary purpose — is close to cross-platform.
The plugin and PI are already fully portable. The bridge core is portable with
minor filesystem fixes. Hook scripts need a Node.js rewrite. These changes
(Phase 1) deliver working approve/deny/cancel on all three platforms.

Text injection into other apps (command buttons, Approve Once, dictation) is
deeply macOS-specific and requires per-platform backends. This is the bulk of
the porting effort and can be delivered incrementally (Phases 2-4) after the
core workflow ships.

## Files Requiring Changes (by phase)

### Phase 1
- `plugin/com.decky.controller.sdPlugin/manifest.json` — add Windows + Linux
- `hooks/pre-tool-use.sh` → `hooks/pre-tool-use.js` (Node.js rewrite)
- `hooks/post-tool-use.sh` → `hooks/post-tool-use.js`
- `hooks/stop.sh` → `hooks/stop.js`
- `hooks/notification.sh` → `hooks/notification.js`
- `hooks/install.sh` → Node.js installer
- `bridge/src/approval-gate.ts` — Windows renameSync fix
- `bridge/src/config.ts` — Windows renameSync fix + platform-aware editor defaults
- `bridge/src/security.ts` — Windows permission handling
- `bridge/src/app.ts` — guard macro-exec calls with platform capability check
- `.github/workflows/plugin-pi-tests.yml` — add platform matrix

### Phase 2
- `bridge/src/macro-exec-win32.ts` (new) — Windows text injection backend
- `bridge/src/macro-exec-router.ts` (new) — platform dispatcher
- `bridge/src/macro-exec.ts` — rename to `macro-exec-darwin.ts`, export same interface

### Phase 3
- `bridge/src/macro-exec-linux.ts` (new) — Linux/X11 text injection backend
- `bridge/src/macro-exec-router.ts` — add Linux backend

### Phase 4
- `plugin/com.decky.controller.sdPlugin/ui/property-inspector-v2.html` — capability gating UI
- `bridge/src/app.ts` — expose platform capabilities in config snapshots
