# Decky Code Review

**Date:** 2026-03-14
**Scope:** Full codebase — bridge, plugin, hooks, tests, CI
**Verified:** All claims independently confirmed against current HEAD (2026-03-14).

Evidence levels used throughout:
- **confirmed-by-code** — verified by reading the source at the cited location
- **confirmed-by-behavior** — verified by running the code or tests
- **hypothesis/hardening** — plausible risk without a demonstrated exploit path

---

## 1. Security

### 1.1 High

**S3 — Timing-unsafe token comparison** `confirmed-by-code`
`bridge/src/app.ts:450` and `:618` — Bearer token compared with `!==`. Vulnerable to timing side-channel. Low practical risk (loopback), but a real vulnerability class.
*Fix:* Use `crypto.timingSafeEqual()` in a shared `validateToken()` helper in `security.ts`.

### 1.2 Medium

**S1 — SVG text interpolation without XML-escaping** `confirmed-by-code`
`plugin/src/layouts.ts` interpolates external data into SVG `<text>` nodes without XML-escaping at lines 564, 578, 591, 601, 629, 659, 1030, 1097, 1107, 1116. Characters like `<`, `>`, `&` in tool names, option labels, or macro labels produce malformed SVG. SVGs are rendered as `data:image/svg+xml` key images (`slot.ts:702`), so impact is malformed rendering/robustness rather than script execution.
*Fix:* Add `escapeXml()` helper; apply to every interpolated value in SVG text nodes.

**S2 — AppleScript window-name escaping is minimal** `hypothesis/hardening`
`bridge/src/macro-exec-darwin.ts:95-113` — `buildRestoreFragment` passes `snapshot.windowName` through `appleScriptString` (line 303), which only escapes `\` and `"`. The code's own comment (line 299) states: "Safe ONLY for non-user-input values." Window names come from running applications via OS APIs, not from untrusted user input. A malicious app could theoretically set its title to attempt AppleScript injection, but no exploit path has been demonstrated.
*Fix:* Escape additional AppleScript-significant characters (backslash, quote, and control chars) in `appleScriptString`. Avoid stripping non-ASCII, which would break legitimate Unicode window titles.

**S4 — curl `-d` interprets leading `@` as file path** `confirmed-by-code`
All shell hooks (`pre-tool-use.sh:56`, `post-tool-use.sh:22`, `notification.sh:22`, `stop.sh:22`, `permission-request.sh:38`) use `curl -d "$PAYLOAD"`. If payload starts with `@`, curl reads a local file.
*Fix:* Replace `-d` with `--data-raw` in all hooks.

**S5 — Unbounded `cwd`/`sessionId` stored and broadcast** `confirmed-by-code`
`bridge/src/app.ts:531-532` — No length cap or character validation. A hook could inject a multi-MB `cwd` string broadcast to all plugin clients.
*Fix:* `cwd.slice(0, 1024)`, `sessionId.slice(0, 256)`.

**S6 — Log buffer accepts unbounded message sizes** `confirmed-by-code`
`bridge/src/app.ts:206-209` — `pushLog` caps buffer at 500 entries but individual messages have no size limit. A single large log call stores an arbitrarily large string.
*Fix:* Cap each log message at ~4096 characters.

**S7 — CORS only on Socket.io, not Express** `confirmed-by-code`
`bridge/src/app.ts:231-238` — REST endpoints lack CORS headers. Not exploitable while loopback-only, but a maintenance trap.
*Fix:* Add Express-level CORS middleware matching the Socket.io policy.

### 1.3 Low

**S8 — Nonce accepted without character-class validation** `confirmed-by-code` (`app.ts:527-530`)
*Fix:* Add hex-only character-class check and length cap (e.g., 128 chars).

**S9 — Gate file TOCTOU** `confirmed-by-code` — stat then read in hooks (`pre-tool-use.sh:88-105`, `pre-tool-use.js:95-116`). Classic TOCTOU but low practical risk on localhost with same-user processes.
*Fix:* Use fd-based read-then-fstat in JS hook; document accepted risk in shell hook.

**S10 — `portableRenameSync` non-atomic on Windows** `confirmed-by-code` (`bridge/src/fs-compat.ts:17-19`). Gap between `unlinkSync` and `renameSync` on Windows.
*Fix:* Add inline comment documenting the accepted non-atomicity.

---

## 2. Correctness Bugs

**B1 — `uninstall.sh:16` — `((removed++))` aborts under `set -e`** `confirmed-by-code`
`set -euo pipefail` is on line 3. When `removed` is 0, `((removed++))` evaluates the old value (0 = falsy in bash arithmetic), returning exit code 1, which triggers `set -e` abort. The script exits after the first successful removal.
*Fix:* `removed=$((removed + 1))`

**B2 — `install.sh:55` — jq shallow merge wipes non-Decky hooks** `confirmed-by-code`
The `*` operator replaces entire event arrays. Non-Decky hooks registered under the same event type are silently deleted. The JS `install.js` (lines 77-83) correctly does per-entry filtering with `.decky/hooks/` path matching.
*Fix:* Match the JS installer's per-entry merge strategy in jq.

**B3 — Both uninstallers delete entire event keys, removing non-Decky hooks** `confirmed-by-code`
`uninstall.js:64-65` uses `delete settings.hooks[event]` and `uninstall.sh:44` uses `jq del(.PermissionRequest, ...)` — both remove all hooks under each event type, not just Decky entries. Inconsistent with `install.js`'s per-entry approach.
*Fix:* Filter to remove only entries whose command contains `.decky/hooks/`, matching install.js's identification strategy.

**B4 — `performMacroSwap` mutates shared config object** `confirmed-by-code`
`plugin/src/actions/slot.ts:468` — `cfg.macros = macros` mutates the reference returned by `getLastConfig()`. If the bridge rejects the update, local state is permanently stale until the next `configUpdate` event.
*Fix:* Use `patchLocalConfig({ macros })` or shallow-copy before mutation.

**B5 — `loadConfig` doesn't bounds-check `approvalTimeout` on read** `confirmed-by-code`
`bridge/src/config.ts:458-461` — `approvalTimeout` is accepted as-is if it's a number, with no clamp. `saveConfig` enforces MIN (5) / MAX (300), but a manually edited config file with `approvalTimeout: 1` is silently accepted on load.
*Fix:* Apply `Math.max(MIN, Math.min(MAX, value))` clamp on read.

---

## 3. Code Quality

### 3.1 Duplication

**Q1 — Type definitions duplicated between `bridge-client.ts` and `layouts.ts`** `confirmed-by-code`
Several types (`TargetApp`, `Theme`, `WidgetKind`, `WidgetDef`, `ColorOverrides`, `QuestionOption`) are independently declared in both files. Not every listed type appears identically in both, but enough overlap exists to create silent divergence risk.
*Fix:* Export canonical types from `bridge-client.ts`, import in `layouts.ts`.

**Q2 — Theme/TargetApp allow-lists duplicated in three places** `confirmed-by-code`
`config.ts:163-179`, `app.ts:856-858`, `app.ts:865-871`. Each location spells out valid values independently.
*Fix:* `const VALID_THEMES = new Set([...])` exported from `config.ts`.

**Q3 — `renderPomodoroSlots` and `renderCountUpSlots` are near-identical** `confirmed-by-code`
`slot.ts:726-798` — same structure, only differ in widget kind and state type.
*Fix:* Extract shared `renderTimerSlots(timerId, widgetKind, setter)`.

**Q4 — `easeOutCubic` defined twice** `confirmed-by-code`
`slot.ts:861` and `slot.ts:1069` — identical inline definitions.
*Fix:* Define once at module scope.

**Q5 — Three slide animations share ~70% of their code** `confirmed-by-code`
`animateApprovalSlideIn` (805-915), `animateApprovalSlideOut` (921-1007), `animateAskingSlideIn` (1013-1102).
*Fix:* Extract `runFrameAnimation()` helper; ~120 lines eliminated.

**Q6 — `updateConfig` socket handler duplicates PUT `/config` validation** `confirmed-by-code`
`app.ts:848-945` — ~100 lines of field-by-field extraction that `saveConfig` already validates.
*Fix:* Extract `applyConfigUpdate(data)` shared by both paths; remove pre-validation.

### 3.2 Design Issues

**Q7 — `HookPayload` open index signature erases type checking** `confirmed-by-code`
`bridge/src/state-machine.ts:45` — `[key: string]: unknown` allows any object.
*Fix:* Explicitly declare optional fields, remove index signature.

**Q8 — `classifyToolRisk` compiles RegExp on every call** `confirmed-by-code`
`bridge/src/app.ts:167-178` — rules recompiled per invocation.
*Fix:* Pre-compile when config loads; store as `RegExp` objects.

**Q9 — `getMacros()` has undocumented render side effects** `confirmed-by-code`
`plugin/src/actions/slot.ts:614-642` — named as a getter but mutates theme/color state via `setTheme()`, `setThemeSeed()`, `setDefaultColors()`, `setWidgetRenderContext()`, `setTargetBadgeOptions()`.
*Fix:* Rename to `syncThemeAndGetMacros()` or split into two functions.

**Q10 — `approvalAttemptContextStack` shared module-level array** `confirmed-by-code`
`bridge/src/macro-exec-darwin.ts:236` — concurrent `approveInTargetApp` calls can corrupt the stack.
*Fix:* Pass `contextId` as a parameter instead.

**Q11 — `setEncoderClient` is dead code** `confirmed-by-code`
`plugin/src/actions/encoder.ts:35` — exported but never imported or called externally. `plugin.ts:17` calls only `initEncoderStateListener`, which also sets `bridgeRef`.
*Fix:* Remove.

**Q12 — `void ev` used as lint suppressor** `confirmed-by-code`
`plugin/src/actions/encoder.ts:135` — non-idiomatic.
*Fix:* Use `_ev: DialDownEvent` parameter prefix.

### 3.3 Architecture Concerns — DEFERRED

*Items Q13-Q17 are acknowledged but held for a future cycle. No implementation planned.*

**Q13 — `app.ts` is a ~995-line monolith** — routes, socket handlers, approval queue, log buffer, config reload all in one file.

**Q14 — Global mutable config state** — `config.ts:160` returns a mutable reference; no deep-freeze.

**Q15 — `console` monkey-patching** — `app.ts:213-227` replaces globals; should use a structured logger.

**Q16 — `layouts.ts` is ~1270 lines** mixing themes, SVG generators, layout queries, and animation helpers. Natural split: `themes.ts`, `svg.ts`, `layouts.ts`, `animation.ts`.

**Q17 — Timer IDs coupled to physical slot indices** — `slot.ts:397` uses `String(slotIndex)` as timer key. Rearranging the deck while a timer runs may cause mismatches.

---

## 4. Test Coverage

### 4.1 Strengths

- Bridge test suite is comprehensive: state machine, approval workflows, gate/mirror flows, security, config CRUD, multi-provider queue, platform macro backends (darwin/linux/win32), MCP endpoints.
- Plugin `layouts.test.ts` is exhaustive: all states, themes, risk colors, badges, widgets, animation frames.
- Bridge tests run CI on ubuntu/macos/windows matrix.
- Hooks JS variants are integration-tested via `hooks.test.ts`.

### 4.2 Gaps

**T2 — `security.ts:redactActionForLog` is untested** `confirmed-by-code`
Sensitive field redaction logic has no coverage.

**T3 — `writeGateFile` nonce path not directly unit-tested** `confirmed-by-code`
`approval-gate.test.ts` only tests bare writes. Nonce-prefixed format tested only indirectly via approval workflow integration tests.

**T4 — No encoder interaction tests** `confirmed-by-code`
`onWillAppear`, `onDialDown`, `onDialRotate`, `cycleThemePreview` — all untested. Only pure helpers covered.

**T5 — Pomodoro long-press reset path untested** `confirmed-by-code`
`slot.ts:401-403` — not covered in `slot-action.render.test.ts`.

**T6 — `patchLocalConfig` untested** `confirmed-by-code`
Used by encoder for theme preview, no direct test.

**T7 — `DECKY_TIMEOUT=0` and negative values not tested in JS hooks** `confirmed-by-code`
`parseInt("0")` returns 0 (falsy), silently falls back to 30.

### 4.3 Infrastructure

**T8 — No TypeScript `--noEmit` check in CI** `confirmed-by-code` — type errors only surface at build time.

**T9 — No ESLint configured** `confirmed-by-code` — neither package has linting.

**T10 — No coverage thresholds** `confirmed-by-code` — not enforced in either vitest config.

**T11 — Plugin test job runs only on ubuntu-latest** `confirmed-by-code` — bridge tests already run on the ubuntu/macos/windows matrix, but the plugin test job (`.github/workflows/plugin-pi-tests.yml:38-39`) is ubuntu-only.

### 4.4 Deferred

**T1 — Shell hook scripts have zero test coverage**
The `.sh` variants are never tested. Requires a shell testing framework (e.g., bats) or subprocess harness — deferred to a future cycle. Bugs in shell hooks (B1, B2, B3, S4) are addressed directly by code fixes.

---

## 5. Phased Work Plan

Each chunk targets ~20 minutes. Checkpoint (commit + update this plan) at the end of each chunk.

### Phase 1: Must-Fix Correctness & Security Defects (3 chunks)

**Chunk 1.1 — Hook script bugs** *(B1, B2, B3)*
- [ ] Fix `uninstall.sh:16` — replace `((removed++))` with `removed=$((removed + 1))` (B1)
- [ ] Fix `install.sh:55` — per-entry merge in jq matching install.js strategy (B2)
- [ ] Fix `uninstall.sh:44` — filter by `.decky/hooks/` path instead of `jq del()` (B3)
- [ ] Fix `uninstall.js:64-65` — filter by `.decky/hooks/` path instead of `delete` (B3)
- [ ] Run tests; commit

**Chunk 1.2 — Token safety + curl hardening + config clamp** *(S3, S4, B5)*
- [ ] Add `validateToken()` with `timingSafeEqual` to `bridge/src/security.ts` (S3)
- [ ] Update callers in `app.ts:450,618` to use `validateToken()` (S3)
- [ ] Replace `curl -d` with `--data-raw` in all 5 shell hooks (S4)
- [ ] Clamp `approvalTimeout` on load in `config.ts:458-461` (B5)
- [ ] Run tests; commit

**Chunk 1.3 — Input bounds + config mutation** *(S5, S6, B4)*
- [ ] Cap `cwd` (1024) and `sessionId` (256) length in `app.ts:531-532` (S5)
- [ ] Cap log message length in `pushLog` at 4096 chars (S6)
- [ ] Fix `performMacroSwap` to shallow-copy or use `patchLocalConfig` (B4)
- [ ] Run tests; commit

### Phase 2: Security Hardening (2 chunks)

**Chunk 2.1 — SVG escaping + nonce validation** *(S1, S8)*
- [ ] Add `escapeXml()` helper to `plugin/src/layouts.ts` (S1)
- [ ] Apply to all 10 SVG text interpolation sites (S1)
- [ ] Add hex-only + length-cap validation for nonce in `app.ts:527-530` (S8)
- [ ] Run tests; commit

**Chunk 2.2 — AppleScript hardening + CORS + docs** *(S2, S7, S9, S10)*
- [ ] Harden `appleScriptString` to escape control chars in addition to `\` and `"` (S2)
- [ ] Add Express-level CORS middleware matching Socket.io policy (S7)
- [ ] Add inline comment documenting accepted TOCTOU in gate polling (S9)
- [ ] Add inline comment documenting Windows non-atomicity in `fs-compat.ts` (S10)
- [ ] Run tests; commit

### Phase 3: Code Deduplication & Quality (3 chunks)

**Chunk 3.1 — Type consolidation + dead code** *(Q1, Q2, Q11, Q12)*
- [ ] Export canonical types from `bridge-client.ts`; update `layouts.ts` imports (Q1)
- [ ] Export `VALID_THEMES`/`VALID_TARGET_APPS` sets from `config.ts`; use in `app.ts` (Q2)
- [ ] Remove dead `setEncoderClient` export (Q11)
- [ ] Fix `void ev` to `_ev` parameter prefix (Q12)
- [ ] Run tests; commit

**Chunk 3.2 — Plugin render deduplication** *(Q3, Q4, Q9)*
- [ ] Extract `renderTimerSlots()` from `renderPomodoroSlots`/`renderCountUpSlots` (Q3)
- [ ] Move `easeOutCubic`/`easeInCubic` to module scope, single definition (Q4)
- [ ] Rename `getMacros()` to `syncThemeAndGetMacros()` (Q9)
- [ ] Run tests; commit

**Chunk 3.3 — Bridge deduplication** *(Q6, Q7, Q8)*
- [ ] Extract `applyConfigUpdate()` shared by socket handler and PUT `/config` (Q6)
- [ ] Remove redundant pre-validation in `updateConfig` socket handler (Q6)
- [ ] Pre-compile `toolRiskRules` patterns on config load (Q8)
- [ ] Fix `HookPayload` — declare optional fields explicitly, remove index signature (Q7)
- [ ] Run tests; commit

### Phase 4: Remaining Quality (2 chunks)

**Chunk 4.1 — Animation extraction** *(Q5)*
- [ ] Extract `runFrameAnimation()` from the three slide animations (Q5)
- [ ] Update `animateApprovalSlideIn`, `animateApprovalSlideOut`, `animateAskingSlideIn` to use it
- [ ] Run tests; commit

**Chunk 4.2 — Context stack fix** *(Q10)*
- [ ] Refactor `approvalAttemptContextStack` — pass `contextId` as parameter (Q10)
- [ ] Run tests; commit

### Phase 5: Test Coverage (3 chunks)

**Chunk 5.1 — Bridge security & gate tests** *(T2, T3, T7)*
- [ ] Add tests for `redactActionForLog` (T2)
- [ ] Add `writeGateFile` nonce-path unit test (T3)
- [ ] Add `DECKY_TIMEOUT=0` and negative value tests (T7)
- [ ] Run tests; commit

**Chunk 5.2 — Plugin interaction tests** *(T4, T5, T6)*
- [ ] Add `patchLocalConfig` unit test (T6)
- [ ] Add Pomodoro long-press reset test (T5)
- [ ] Add encoder interaction test stubs for `onDialDown`/`onDialRotate` (T4)
- [ ] Run tests; commit

**Chunk 5.3 — CI hardening** *(T8, T10, T11)*
- [ ] Add `tsc --noEmit` step to CI for both packages (T8)
- [ ] Add plugin test job runs on macOS/Windows (T11)
- [ ] Add coverage thresholds to vitest configs (T10)
- [ ] Run tests; commit

**Chunk 5.4 — ESLint setup** *(T9)*
- [ ] Configure ESLint for bridge package (T9)
- [ ] Configure ESLint for plugin package (T9)
- [ ] Fix any lint errors surfaced
- [ ] Run lint + tests; commit

---

## Issue Index

| ID | Type | Severity | Evidence | Location | Status |
|----|------|----------|----------|----------|--------|
| S1 | Security | Medium | confirmed-by-code | `plugin/src/layouts.ts` (10 sites) | Open |
| S2 | Security | Medium | hypothesis | `bridge/src/macro-exec-darwin.ts:95` | Open |
| S3 | Security | High | confirmed-by-code | `bridge/src/app.ts:450,618` | Open |
| S4 | Security | Medium | confirmed-by-code | All `.sh` hooks | Open |
| S5 | Security | Medium | confirmed-by-code | `bridge/src/app.ts:531-532` | Open |
| S6 | Security | Medium | confirmed-by-code | `bridge/src/app.ts:206` | Open |
| S7 | Security | Medium | confirmed-by-code | `bridge/src/app.ts:231` | Open |
| S8 | Security | Low | confirmed-by-code | `bridge/src/app.ts:527` | Open |
| S9 | Security | Low | confirmed-by-code | hooks TOCTOU | Open |
| S10 | Security | Low | confirmed-by-code | `bridge/src/fs-compat.ts:17` | Open |
| B1 | Bug | High | confirmed-by-code | `hooks/uninstall.sh:16` | Open |
| B2 | Bug | High | confirmed-by-code | `hooks/install.sh:55` | Open |
| B3 | Bug | Medium | confirmed-by-code | `hooks/uninstall.js:64`, `uninstall.sh:44` | Open |
| B4 | Bug | Medium | confirmed-by-code | `plugin/src/actions/slot.ts:468` | Open |
| B5 | Bug | Medium | confirmed-by-code | `bridge/src/config.ts:458` | Open |
| Q1 | Quality | Medium | confirmed-by-code | `plugin/src/layouts.ts`, `bridge-client.ts` | Open |
| Q2 | Quality | Medium | confirmed-by-code | `bridge/src/config.ts`, `app.ts` | Open |
| Q3 | Quality | Low | confirmed-by-code | `plugin/src/actions/slot.ts:726` | Done |
| Q4 | Quality | Low | confirmed-by-code | `plugin/src/actions/slot.ts:861,1069` | Done |
| Q5 | Quality | Low | confirmed-by-code | `plugin/src/actions/slot.ts:805-1102` | Done |
| Q6 | Quality | Medium | confirmed-by-code | `bridge/src/app.ts:848` | Done |
| Q7 | Quality | Medium | confirmed-by-code | `bridge/src/state-machine.ts:45` | Done |
| Q8 | Quality | Medium | confirmed-by-code | `bridge/src/app.ts:167` | Done |
| Q9 | Quality | Low | confirmed-by-code | `plugin/src/actions/slot.ts:614` | Done |
| Q10 | Quality | Medium | confirmed-by-code | `bridge/src/macro-exec-darwin.ts:236` | Done |
| Q11 | Quality | Low | confirmed-by-code | `plugin/src/actions/encoder.ts:35` | Open |
| Q12 | Quality | Low | confirmed-by-code | `plugin/src/actions/encoder.ts:135` | Open |
| Q13 | Quality | Low | confirmed-by-code | `bridge/src/app.ts` | Deferred |
| Q14 | Quality | Low | confirmed-by-code | `bridge/src/config.ts:160` | Deferred |
| Q15 | Quality | Low | confirmed-by-code | `bridge/src/app.ts:213` | Deferred |
| Q16 | Quality | Low | confirmed-by-code | `plugin/src/layouts.ts` | Deferred |
| Q17 | Quality | Low | confirmed-by-code | `plugin/src/actions/slot.ts:397` | Deferred |
| T1 | Testing | Medium | confirmed-by-code | hooks `.sh` scripts | Deferred |
| T2 | Testing | Medium | confirmed-by-code | `bridge/src/security.ts:85` | Done |
| T3 | Testing | Low | confirmed-by-code | `bridge/src/__tests__/approval-gate.test.ts` | Done |
| T4 | Testing | Low | confirmed-by-code | `plugin/src/actions/encoder.ts` | Open |
| T5 | Testing | Low | confirmed-by-code | `plugin/src/actions/slot.ts:401` | Done |
| T6 | Testing | Low | confirmed-by-code | `plugin/src/bridge-client.ts` | Done |
| T7 | Testing | Low | confirmed-by-code | `hooks/pre-tool-use.js:25` | Done |
| T8 | Testing | Medium | confirmed-by-code | `.github/workflows/plugin-pi-tests.yml` | Open |
| T9 | Testing | Low | confirmed-by-code | project-wide | Open |
| T10 | Testing | Low | confirmed-by-code | vitest configs | Open |
| T11 | Testing | Low | confirmed-by-code | `.github/workflows/plugin-pi-tests.yml:38` | Open |
