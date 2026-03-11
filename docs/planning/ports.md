# Porting Decky to Windows and Linux

Fresh analysis based on the codebase as of 2026-03-10.
Updated 2026-03-11 to reflect security hardening (commit `b527bec`, tag `v0.2`).

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

## Implementation Status

All three stages are implemented and tested. Pending user testing on Windows
and Linux machines.

- **Stage 1 (macOS foundation):** Complete — commit `8077b84`
- **Stage 2 (Windows):** Complete — commit `1c84aed`
- **Stage 3 (Linux):** Complete — see latest commit

## Recommended Staged Approach

Work is organized by platform rather than by feature. Each stage must reach a
stable, user-tested state before the next stage begins. macOS is never left
broken — all portability prep work happens on macOS first, and we verify
feature parity before moving on.

---

### Stage 1: macOS — Portability Foundation ✅

**Goal:** Rewrite all macOS-specific non-automation code into cross-platform
form, running and testing everything on macOS. At the end of this stage, Decky
on macOS works exactly as it does today — no regressions — but the codebase is
ready for other platforms.

#### 1a. Rewrite hook scripts in Node.js

Replace the five Bash hook scripts with equivalent Node.js scripts. This is the
highest-risk portability change because it touches the security-critical
approval path. Must preserve nonce validation, timeout, and fail-closed
semantics. Hook scripts must continue to re-read `~/.decky/bridge-token` on
each invocation (not cache it) since the token now rotates on every bridge
start (v0.2 security hardening).

- `hooks/pre-tool-use.sh` → `hooks/pre-tool-use.js` (gate flow — legacy, opt-in)
- `hooks/permission-request.sh` → `hooks/permission-request.js` (mirror flow — default)
- `hooks/post-tool-use.sh` → `hooks/post-tool-use.js`
- `hooks/stop.sh` → `hooks/stop.js`
- `hooks/notification.sh` → `hooks/notification.js`
- Update `hooks/install.sh` and `hooks/uninstall.sh` to handle `.js` hooks.
  The install script must preserve 0700 permissions on the hooks directory and
  scripts (v0.2 security hardening).

**Test on macOS:** Run through the full approval workflow (approve, deny,
cancel), command buttons, and Approve Once. Verify identical behavior to the
Bash hooks. The 39 security tests in `security.test.ts` (v0.2) serve as a
regression safety net — run `npm test` after each change.

#### 1b. Fix filesystem portability in bridge

These changes prepare the bridge for Windows but are safe no-ops on macOS:

- `bridge/src/approval-gate.ts` — wrap `renameSync` in unlink-then-rename
  helper that only triggers on EPERM (Windows). No behavior change on macOS.
- `bridge/src/config.ts` — same `renameSync` fix in `writeConfigAtomically()`.
- `bridge/src/security.ts` — accept that `mode: 0o600` bits (used by both
  `getBridgeToken()` and `rotateBridgeToken()`) are no-ops on Windows. No
  code change needed; just document the decision. On Windows, the user's home
  directory ACLs provide equivalent protection.

#### 1c. Add platform capability guards

- `bridge/src/app.ts` — add a `process.platform` check around macro-exec
  calls so that unsupported actions on non-macOS platforms return a structured
  error to the plugin instead of crashing. On macOS this guard is a no-op.
- `bridge/src/macro-exec.ts` — rename to `macro-exec-darwin.ts` and create
  `macro-exec-router.ts` that delegates to the correct backend by platform.
  Initially only the darwin backend exists; other platforms get the
  "not supported" error path.

#### 1d. Manifest and CI

- `plugin/com.decky.controller.sdPlugin/manifest.json` — add Windows and Linux
  to the OS array.
- `.github/workflows/plugin-pi-tests.yml` — add macOS and Windows runners for
  bridge tests (matrix strategy).

#### 1e. Polish and documentation

- Add capability flags to bridge config snapshots so the PI can hide/disable
  action types not supported on the current platform.
- Update PI to show disabled states for unsupported actions.
- Decide on Talk to Claude: keep as macOS-only and document, or investigate
  platform alternatives.

### 🚦 Testing Gate: macOS Feature Parity

**Before proceeding to Stage 2, the user tests on macOS and confirms:**

- [ ] Approval workflow (approve/deny/cancel) works identically to pre-port
- [ ] Command buttons (text injection) work
- [ ] Approve Once works
- [ ] Hook scripts (now Node.js) handle edge cases: timeout, bridge down, nonce mismatch
- [ ] Hook scripts correctly re-read rotating token on each invocation
- [ ] PI shows/hides action types appropriately
- [ ] CI passes on all matrix runners
- [ ] All 151+ bridge tests pass (including 39 security tests from v0.2)

---

### Stage 2: Windows Port ✅

**Goal:** Decky runs on Windows with at minimum the core approval workflow.
Text injection is a stretch goal for this stage. Testing is done by friends
with Windows machines.

#### 2a. Core approval workflow on Windows

At this point the hook scripts (Node.js), filesystem fixes (renameSync), and
manifest changes are already in place from Stage 1. The core approval workflow
(approve/deny/cancel buttons, state display, widgets, config editing) should
work on Windows out of the box.

- Verify bridge starts and serves on Windows.
- Verify plugin loads in StreamDeck on Windows.
- Verify hook scripts work with Claude Code on Windows.
- Fix any Windows-specific issues discovered during testing.

#### 2b. Windows text injection backend

- Create `bridge/src/macro-exec-win32.ts` implementing clipboard + activate +
  paste + keystroke via PowerShell or `@nut-tree/nut-js`.
- Build Windows app-identification mapping (window titles for Claude, Codex,
  ChatGPT, Cursor, Windsurf).
- Wire into `macro-exec-router.ts`.

#### 2c. Windows approval automation (stretch)

- Implement `approveInTargetApp` and `dismissApprovalInTargetApp` using
  Windows UI Automation API.
- This is the hardest part — button labels and window structures can change
  between app versions. May ship as macOS-only initially if too fragile.

### 🚦 Testing Gate: Windows Approval Workflow

**Before proceeding to Stage 3, friends test on Windows and confirm:**

- [ ] Bridge + plugin start and connect
- [ ] Approve/deny/cancel work via StreamDeck
- [ ] Command buttons work (if 2b is complete), or show clear "not supported" error
- [ ] Hook scripts work correctly with Claude Code on Windows
- [ ] No regressions on macOS (user re-tests)

---

### Stage 3: Linux Port ✅

**Goal:** Decky runs on Linux under X11 with the core approval workflow and
text injection. Wayland limitations are documented.

#### 3a. Core approval workflow on Linux

Same as Windows — the cross-platform foundation from Stage 1 should make this
work with minimal effort. Verify bridge, plugin (community StreamDeck host),
and hooks on Linux.

**Note:** No official Elgato StreamDeck host exists for Linux. Community tools
(streamdeck-ui, etc.) may not fully implement SDK v2. This is a known
limitation outside Decky's control.

#### 3b. Linux text injection backend (X11)

- Create `bridge/src/macro-exec-linux.ts` using `xclip` + `xdotool`.
- Build `WM_CLASS` mapping for the five target apps.
- Focus capture/restore via `xdotool getactivewindow` / `windowactivate`.
- Wire into `macro-exec-router.ts`.

#### 3c. Wayland detection and documentation

Wayland's security model deliberately prevents applications from activating
other windows or injecting keystrokes. `xdotool` does not work under Wayland.
`ydotool` requires elevated privileges. This is a fundamental platform
limitation, not a Decky limitation.

- Detect Wayland at runtime (`$XDG_SESSION_TYPE === "wayland"` or
  `process.env.XDG_SESSION_TYPE`).
- Show a clear message in the PI and on button press: text injection requires
  X11.
- Document in README.

### 🚦 Testing Gate: Linux

**Confirm on Linux (X11):**

- [ ] Bridge + plugin start and connect (with community StreamDeck host)
- [ ] Approve/deny/cancel work
- [ ] Command buttons work under X11
- [ ] Wayland detected and clearly reported as unsupported for text injection
- [ ] No regressions on macOS or Windows

---

## Risk Summary

| Risk | Severity | Notes |
|------|----------|-------|
| `macro-exec.ts` rewrite scope | High | 691 lines of deeply macOS-specific automation. Each platform needs different app identification, different automation APIs, different timing. |
| Wayland text injection | High | Fundamental platform limitation. No reliable solution exists. Must be documented as unsupported. |
| Linux Stream Deck host | Medium | No official Elgato host for Linux. Community tools (streamdeck-ui, etc.) may not fully implement SDK v2. |
| Hook script rewrite | Medium | Straightforward but touches the security-critical approval path. Must preserve nonce validation, timeout, fail-closed semantics, and fresh token reads (for rotation). Mitigated by doing this first on macOS, the v0.2 security test suite (39 tests covering auth, CORS, config validation), and user-testing before moving on. |
| Windows `renameSync` EPERM | Low | Well-understood fix: unlink + rename. Affects approval-gate and config writes. |
| Windows UI Automation fragility | Medium | Button labels and window structures can change between app versions. Approve Once on Windows may be brittle. |

## Effort Estimates

| Stage | Estimate | Notes |
|-------|----------|-------|
| Stage 1 (macOS foundation) | 4-6 days | Hook rewrite (5 hooks + install/uninstall) is the largest substage. Filesystem fixes and manifest are quick. Security test suite provides regression safety. |
| Stage 2 (Windows) | 5-8 days | Core workflow may "just work". Text injection backend is the bulk. UI Automation is a stretch. |
| Stage 3 (Linux) | 3-5 days | X11 backend is simpler than Windows. Wayland is documented as unsupported. |
| **Total** | **12-19 days** | Sequenced with testing gates; actual calendar time will be longer. |

## Summary

Work is sequenced to protect macOS stability. Stage 1 does all the risky
cross-platform prep on macOS — rewriting hooks in Node.js, fixing filesystem
calls, adding platform routing — and pauses for user testing to confirm
feature parity. Only after macOS is verified stable does Stage 2 bring up
Windows, tested by friends. Stage 3 adds Linux/X11 support last.

The core approval workflow — Decky's primary purpose — becomes cross-platform
in Stage 1 and should work on Windows and Linux with minimal additional effort
in Stages 2a/3a. The per-platform text injection backends (Stages 2b/3b) are
the bulk of the porting effort and can be delivered incrementally.

## Files Changed (actual implementation)

### Stage 1 (macOS foundation) — commit `8077b84`
- `hooks/*.js` — Node.js rewrites of all hook scripts (install, uninstall, pre-tool-use, post-tool-use, permission-request, stop, notification)
- `bridge/src/fs-compat.ts` — `portableRenameSync` helper
- `bridge/src/approval-gate.ts`, `bridge/src/config.ts` — use portableRenameSync
- `bridge/src/macro-exec-darwin.ts` — renamed from macro-exec.ts
- `bridge/src/macro-exec.ts` — platform router (lazy-loads darwin/win32/linux)
- `bridge/src/app.ts` — platform capabilities in state payload
- `plugin/src/bridge-client.ts` — PlatformCapabilities interface
- `plugin/src/actions/slot.ts` — forward capabilities in configSnapshot
- `plugin/com.decky.controller.sdPlugin/ui/property-inspector-v2.html` — capability gating
- `plugin/com.decky.controller.sdPlugin/manifest.json` — add Windows + Linux
- `.github/workflows/plugin-pi-tests.yml` — 3-OS CI matrix

### Stage 2 (Windows) — commit `1c84aed`
- `bridge/src/macro-exec-win32.ts` — PowerShell + clip.exe + UI Automation
- `bridge/src/macro-exec.ts` — add win32 lazy-load
- `bridge/src/app.ts` — textInjection/approveInApp for win32
- `bridge/package.json` — remove Unix-only env var from test script
- `bridge/src/__tests__/macro-exec.test.ts` — import darwin directly, skipIf
- `bridge/src/__tests__/macro-exec-win32.test.ts` — 15 tests

### Stage 3 (Linux)
- `bridge/src/macro-exec-linux.ts` — xdotool + xclip, Wayland detection
- `bridge/src/macro-exec.ts` — add linux lazy-load
- `bridge/src/app.ts` — textInjection/approveInApp for linux
- `bridge/src/__tests__/macro-exec-linux.test.ts` — 14 tests
- `plugin/com.decky.controller.sdPlugin/ui/property-inspector-v2.html` — Wayland hint
