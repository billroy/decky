# Decky Security Review

Date: 2026-03-11
Scope: `bridge/`, `hooks/`, `plugin/`, install scripts, dependency audit
Method: Full static code review against the codebase at commit `717147c`

## Prior Review Assessment

An earlier review (`codex-security-review.md`, 2026-03-07) was verified against
the current code. Several of its findings are factually incorrect:

| Codex finding | Verdict | Detail |
|---------------|---------|--------|
| "No authentication on bridge" | **Wrong** | Token-based auth exists on both HTTP (middleware at app.ts:319-325) and Socket.io (app.ts:436-445). |
| "CORS origin: *" | **Wrong** | CORS callback restricts to localhost/127.0.0.1 only (app.ts:142-149). |
| "Listens without loopback bind" | **Wrong** | server.ts:14 explicitly binds to `HOST = "127.0.0.1"`. |
| "Pre-tool gate is fail-open" | **Wrong** | pre-tool-use.sh exits 2 (block) on timeout, nonce mismatch, and unknown values. It is fail-closed. |
| "No config input validation" | **Wrong** | config.ts has comprehensive validation: max macros, label/text length limits, timeout bounds, strict type checks. |
| "Payloads logged verbatim" | **Wrong** | `redactActionForLog()` in security.ts replaces text with `[redacted:N]`. |

The codex review was either based on a much earlier version of the code or
contained hallucinated findings. Do not rely on it.

## Threat Model

Decky is a **local-machine, single-user tool**. The bridge runs on localhost,
the plugin runs inside the StreamDeck desktop app, and hook scripts run as the
current user invoked by Claude Code. The primary security boundary is:

- **Threat actor:** A malicious process running as the same local user.
- **Critical asset:** The approval gate — the ability to approve or deny Claude
  Code tool execution.
- **Secondary asset:** Config integrity and macro injection capability.

Network-level attacks are out of scope when `DECKY_HOST=127.0.0.1` (the
default). Same-user local process attacks are the realistic threat.

---

## Findings

### 1. Bridge token is trivially readable by any same-user process

**Severity: Medium**
**Location:** `bridge/src/security.ts:42`, `~/.decky/bridge-token`

The bridge authenticates HTTP and Socket.io requests using a shared token stored
at `~/.decky/bridge-token` with `mode: 0o600`. While this prevents other-user
reads, any process running as the same user — malware, a rogue npm postinstall
script, a compromised VS Code extension — can:

1. `cat ~/.decky/bridge-token`
2. Use the token to call any bridge endpoint

Once obtained, the attacker can approve/deny tool use, inject macro text into
Claude, and modify the config. The token never expires and never rotates (even
across bridge restarts — it reuses the existing file).

This is the issue noted by the project owner: curl commands with the token
can trigger the approval UI with no additional challenge.

**Impact:** Full bridge control by any same-user local process.

**Mitigations in place:** File mode 0o600, loopback-only binding.

**Remediation options (pick one or combine):**
- **Token rotation:** Regenerate on each bridge start. Hook scripts re-read
  from the file on each invocation, so this is backward compatible. The plugin
  re-reads on reconnect. This limits the window of exposure.
- **Per-request HMAC:** Instead of a static bearer token, derive a per-request
  HMAC using the token as key and a timestamp/nonce. The raw token never
  appears in HTTP headers, so sniffing localhost traffic doesn't leak it.
- **Unix domain socket:** Replace TCP port 9130 with a socket file at
  `~/.decky/bridge.sock` with mode 0o600. OS enforces that only the owning
  user can connect. No token needed for auth — filesystem permissions handle it.
  Harder for attackers to intercept than TCP even on loopback.

**Priority: P2** — The realistic attack requires a compromised same-user
process, at which point the attacker likely has broader access anyway. But
rotation is cheap and limits blast radius.

---

### 2. `DECKY_HOST` env var can silently expose bridge to the network

**Severity: High (when misconfigured)**
**Location:** `bridge/src/server.ts:10`

```typescript
const HOST = process.env.DECKY_HOST ?? "127.0.0.1";
```

Setting `DECKY_HOST=0.0.0.0` opens the bridge to all network interfaces. The
token becomes the sole defense against remote attackers. No warning is logged,
and the CORS policy still only allows localhost origins — but CORS is only
enforced by browsers, not by curl/scripts.

**Impact:** Remote approve/deny/cancel/macro execution if an attacker knows or
brute-forces the token.

**Remediation:**
- Log a prominent warning when binding to a non-loopback address.
- Consider requiring an explicit `--allow-remote` flag or env var instead of
  silently accepting `DECKY_HOST=0.0.0.0`.
- If remote access is ever needed, add TLS.

**Priority: P1** — The default is safe, but a single env var change removes
the primary security boundary with no warning.

---

### 3. TOCTOU race in gate file integrity check

**Severity: Low**
**Location:** `hooks/pre-tool-use.sh:87-96`

The gate flow (legacy, opt-in) checks the gate file's UID and permissions via
`stat`, then reads it via `cat` in separate operations:

```bash
FILE_UID="$(stat -f '%u' "$GATE_FILE" ...)"
FILE_MODE="$(stat -f '%OLp' "$GATE_FILE" ...)"
# ...integrity check...
RESULT="$(cat "$GATE_FILE")"
```

Between `stat` and `cat`, an attacker could replace the file. However, this is
substantially mitigated by:
- The nonce check that follows (attacker needs to know the per-request nonce)
- The nonce is generated via `/dev/urandom` and sent only over localhost HTTP
- Gate flow is opt-in; the default mirror flow never reads the gate file

**Impact:** Theoretical gate bypass in gate flow only, requires nonce knowledge.

**Remediation:**
- Read the file once, check nonce in-memory (eliminates the TOCTOU window).
- Or: this becomes moot when hooks are rewritten in Node.js (Stage 1 of the
  ports plan), where we can do atomic read-and-validate.

**Priority: P3** — Gate flow is deprecated and the nonce mitigates the race.

---

### 4. No rate limiting on any endpoint

**Severity: Low-Medium**
**Location:** `bridge/src/app.ts` (all routes)

No rate limiting middleware exists. A local attacker (or a bug in the hook
scripts) could:
- Rapid-fire approve/deny actions, causing state machine churn
- Flood `/hook` with events, filling the approval queue
- Send many `updateConfig` actions, causing rapid disk writes and config backup
  rotation
- DoS the bridge by exhausting CPU/memory with concurrent requests

**Impact:** Denial of service or state confusion.

**Remediation:**
- Add basic rate limiting per IP (even on localhost, rate per socket is useful).
  `express-rate-limit` with a generous window (e.g., 60 req/min on
  `/config` routes, 200/min on `/hook`).
- Socket.io: add per-action throttle (e.g., max 5 approval actions per second).

**Priority: P3** — Low real-world impact for a single-user local tool, but
cheap to add.

---

### 5. No explicit body size limit on Express or Socket.io

**Severity: Low**
**Location:** `bridge/src/app.ts:318`

```typescript
app.use(express.json());
```

Express defaults to 100KB body limit (reasonable), but it's not made explicit.
Socket.io defaults to 1MB `maxHttpBufferSize`. A malicious client could send
large payloads to consume memory.

**Impact:** Potential memory pressure from oversized payloads.

**Remediation:**
- Set explicit limits: `express.json({ limit: '100kb' })`.
- Set `maxHttpBufferSize` on Socket.io: `new SocketIOServer(httpServer, { maxHttpBufferSize: 100_000 })`.

**Priority: P3** — The defaults are reasonable for a localhost service.

---

### 6. install.sh writes hooks to global Claude Code settings

**Severity: Medium**
**Location:** `hooks/install.sh:57`

The installer writes hook entries to `~/.claude/settings.json` (global), not
`settings.local.json` (per-project). This means Decky's hooks intercept tool
use across ALL Claude Code sessions and projects, not just the ones where the
user wants StreamDeck control.

If an attacker compromised the hook scripts at `~/.decky/hooks/`, they would
intercept every tool execution across all projects.

**Impact:** Global hook scope increases blast radius of a hook compromise.

**Remediation:**
- Document this scope clearly in the install output.
- Consider offering a per-project install mode that writes to
  `settings.local.json` for users who want limited scope.
- Lock down `~/.decky/hooks/` permissions to 0o700 after install.

**Priority: P2** — By design (needed for PermissionRequest hooks), but the
global scope should be an informed choice.

---

### 7. Macro text gives bridge full clipboard + keystroke injection

**Severity: Medium (by design)**
**Location:** `bridge/src/macro-exec.ts:124-212`

The `executeMacro` function copies arbitrary text to the system clipboard and
pastes it into the target application. A caller with a valid token can inject
any text into Claude, Codex, ChatGPT, Cursor, or Windsurf and optionally submit
it (keystroke Return).

This is the intended feature, but it means bridge access = arbitrary text
injection into AI coding assistants. Combined with finding #1, any same-user
process that reads the token file can instruct Claude to execute arbitrary
commands.

**Impact:** Arbitrary prompt injection into AI assistants.

**Mitigations in place:** Token auth, 2000-char limit on macro text, loopback
only.

**Remediation:**
- Consider a confirmation step for macros exceeding a length threshold.
- Log all macro executions (already done, with redaction).
- Token rotation (finding #1) limits the window.

**Priority: P2** — Inherent to the feature; mitigation is defense-in-depth.

---

### 8. Debug endpoint exposes operational data

**Severity: Low**
**Location:** `bridge/src/app.ts:371-385`

`GET /debug/approval-trace` returns detailed traces including tool names,
approval actions, state transitions, socket IDs, and timing information.
Protected by the same token auth, but provides an attacker with rich
reconnaissance data about the user's Claude Code activity.

**Impact:** Information disclosure to an attacker who has the bridge token.

**Remediation:**
- Gate debug endpoints behind a separate `DECKY_DEBUG=1` env var.
- Or: accept the risk since token access already implies full control.

**Priority: P3** — Token access already grants full control; this is marginal.

---

### 9. AppleScript string escaping is minimal

**Severity: Low**
**Location:** `bridge/src/macro-exec.ts:296-298`

```typescript
function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
```

This only escapes `\` and `"`. AppleScript strings can also contain other
special sequences. However, this function is only called with:
- `spec.appName` (hardcoded: "Claude", "Codex", etc.)
- `snapshot.processName` (from System Events — OS-provided)
- `snapshot.windowName` (from System Events — OS-provided)

No user-provided input reaches this function. The macro text goes through
`pbcopy` stdin (no shell interpretation). The `execFile` usage throughout
macro-exec.ts correctly avoids shell injection.

**Impact:** No current vulnerability, but a latent risk if user input is ever
routed through AppleScript string interpolation.

**Remediation:**
- Add a comment documenting that this function must never receive untrusted input.
- Or: harden the escaping to cover all AppleScript special characters.

**Priority: P4** — No exploitable path exists today.

---

## Positive Observations

1. **Token auth exists and works.** Both HTTP middleware and Socket.io
   connection handler enforce token validation. Unauthorized requests get 401/disconnect.

2. **CORS is properly restricted.** The callback-based CORS policy only allows
   localhost/127.0.0.1 origins, not wildcard.

3. **Server binds to loopback by default.** `127.0.0.1` is the default, not
   `0.0.0.0`.

4. **Pre-tool hook is fail-closed.** Timeout → block. Nonce mismatch → block.
   Unknown value → block. Bridge down → block.

5. **Gate file has nonce protection.** The per-request nonce prevents replay and
   forgery of gate files (within the gate flow).

6. **Gate file has ownership/permission checks.** UID and mode are verified
   before trusting content.

7. **Config has comprehensive validation.** Max macros (36), label length (20),
   text length (2000), timeout bounds (5-300s), icon length, type whitelist,
   color hex format validation.

8. **`execFile` used throughout, not `exec`.** No shell interpretation of
   arguments. Macro text goes through stdin, not command-line arguments.

9. **Sensitive data is redacted in logs.** `redactActionForLog()` replaces
   macro text and config text fields with `[redacted:N]`.

10. **PI HTML properly escapes user data.** The `esc()` function sanitizes
    `&`, `"`, `<`, `>` for all user-provided values injected into innerHTML.

11. **No npm audit vulnerabilities.** Both packages pass `npm audit` with zero
    vulnerabilities as of 2026-03-11.

---

## Prioritized Remediation Plan

| Priority | Finding | Effort | Action |
|----------|---------|--------|--------|
| **P1** | #2 Network exposure via DECKY_HOST | Trivial | Log warning when binding non-loopback; optionally require `--allow-remote` |
| **P2** | #1 Static token never rotates | Small | Regenerate token on bridge start; hook scripts already re-read per invocation |
| **P2** | #6 Global hook scope | Trivial | Document; lock `~/.decky/hooks/` to 0o700; offer per-project install |
| **P2** | #7 Macro injection via token | Small | Token rotation from #1 is the main mitigation |
| **P3** | #3 TOCTOU in gate file | None | Will be eliminated by Node.js hook rewrite (ports Stage 1) |
| **P3** | #4 No rate limiting | Small | Add `express-rate-limit`; add per-action Socket.io throttle |
| **P3** | #5 Implicit body size limits | Trivial | Make `express.json({ limit })` and `maxHttpBufferSize` explicit |
| **P3** | #8 Debug endpoint exposure | Trivial | Gate behind `DECKY_DEBUG` env var |
| **P4** | #9 AppleScript escaping | Trivial | Add comment or harden; no exploitable path today |

## Security Test Coverage Gaps

The following security behaviors should have automated tests:

- [ ] HTTP requests without token get 401
- [ ] Socket.io connections without token get disconnected
- [ ] Socket.io connections with wrong token get disconnected
- [ ] CORS rejects non-localhost origins
- [ ] Config validation rejects oversized payloads
- [ ] Config validation rejects out-of-range `approvalTimeout`
- [ ] Macro action rejects text exceeding `MAX_MACRO_ACTION_TEXT`
- [ ] Pre-tool hook exits 2 on nonce mismatch (integration test)
- [ ] Pre-tool hook exits 2 on timeout (integration test)
- [ ] Pre-tool hook exits 2 when bridge returns non-2xx

Some of these may already be covered indirectly by existing tests. A dedicated
security test suite would make the guarantees explicit and prevent regressions.
