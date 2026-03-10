# Decky Security Review

Date: 2026-03-07
Reviewer: Codex (static review)
Scope: `bridge/`, `hooks/`, `plugin/`, install/start scripts

## Executive summary
The codebase has multiple high-risk issues centered on unauthenticated control of the bridge service and fail-open approval behavior. In the current design, any process (and potentially any host on the same network, depending on bind behavior/firewall) can issue control actions that approve/deny/cancel tool execution, modify configuration, and inject arbitrary macro text into Claude.

## Findings

### 1. Unauthenticated bridge control + permissive Socket.io CORS enables unauthorized actions
Severity: High

Locations:
- `bridge/src/app.ts:36`
- `bridge/src/app.ts:56`
- `bridge/src/app.ts:95`
- `bridge/src/app.ts:110`
- `bridge/src/app.ts:116`
- `bridge/src/server.ts:13`

What happens:
- The bridge exposes HTTP and Socket.io endpoints with no authentication/authorization.
- Socket.io is configured with `cors: { origin: "*" }`.
- The server listens without an explicit loopback bind (`httpServer.listen(PORT)`), which commonly binds to all interfaces.
- Any client that can reach port `9130` can send `action` messages (`approve`, `deny`, `cancel`, `macro`, `updateConfig`, `restart`) and call config endpoints.

Impact:
- Unauthorized approval or denial of tool executions.
- Forced cancellation/restart of sessions.
- Arbitrary macro injection into Claude input (`macro` action).
- Remote tampering with `~/.decky/config.json` via `/config` or `updateConfig` action.

Remediation:
- Bind explicitly to loopback (`127.0.0.1`) unless remote access is intentionally required.
- Add authentication for both REST and Socket.io (shared secret, signed token, or local Unix socket approach).
- Restrict Socket.io CORS to trusted origins only; avoid wildcard.
- Validate and authorize per-action server-side before mutating state.

---

### 2. Pre-tool approval gate is fail-open on timeout and unknown values
Severity: High

Locations:
- `hooks/pre-tool-use.sh:38`
- `hooks/pre-tool-use.sh:39`
- `hooks/pre-tool-use.sh:40`
- `hooks/pre-tool-use.sh:61`
- `hooks/pre-tool-use.sh:62`
- `hooks/pre-tool-use.sh:63`

What happens:
- On timeout, the hook exits `0` (approve).
- If gate content is unknown/corrupted, it also exits `0`.

Impact:
- Any bridge outage, race, or tampering results in automatic approval.
- This defeats the core security property (human-in-the-loop tool approval).

Remediation:
- Switch to fail-closed behavior: timeout/invalid gate value should block (`exit 2`) with clear reason.
- Consider explicit policy flag for fail-open only when deliberately configured.
- Emit structured error JSON for timeout/invalid-state cases to improve operator visibility.

---

### 3. Approval gate file is writable/trusts ambient local state
Severity: Medium

Locations:
- `bridge/src/approval-gate.ts:25`
- `bridge/src/approval-gate.ts:27`
- `hooks/pre-tool-use.sh:45`

What happens:
- Approval decisions are communicated via plain file `~/.decky/approval-gate` with no integrity/authenticity checks.
- Any process running as the same user can pre-create or overwrite this file with `approve`.

Impact:
- Local process compromise (or another local tool) can bypass manual approval controls.

Remediation:
- Replace file signaling with authenticated IPC (Unix domain socket, named pipe with strict permissions, or signed token challenge/response).
- If file signaling remains, enforce `umask 077`, atomic write+rename, strict ownership/mode checks before trusting content, and include a nonce per approval request.

---

### 4. Unbounded config input can cause abuse/DoS and unsafe state
Severity: Medium

Locations:
- `bridge/src/app.ts:140`
- `bridge/src/config.ts:92`
- `bridge/src/config.ts:99`

What happens:
- `updateConfig` and `PUT /config` accept arbitrary array/object shapes and sizes for `macros` and unchecked numeric `approvalTimeout`.
- No upper bounds on string lengths, macro count, or timeout range.

Impact:
- Large payloads can bloat memory/disk and degrade plugin rendering.
- Invalid config can put the system in inconsistent or risky states (e.g., very large/small timeout behavior).

Remediation:
- Add strict schema validation (type/length/range).
- Enforce max macro count (already implied as 6), max label/text lengths, and timeout bounds.
- Reject malformed data with `400` instead of persisting.

---

### 5. Sensitive action payloads are logged verbatim
Severity: Low

Location:
- `bridge/src/app.ts:117`

What happens:
- The server logs full action payloads (`JSON.stringify(data)`), which can include macro text.

Impact:
- User-entered macro content may contain sensitive text and is written to logs.

Remediation:
- Redact sensitive fields (`text`, potentially config payloads) or log only action names and metadata.

## Positive observations
- `macro-exec.ts` uses `execFile` with argument arrays, reducing shell-injection risk from macro text.
- Hook scripts quote variables in `curl` and file operations, reducing common shell expansion issues.

## Suggested hardening plan (priority order)
1. Add authentication and loopback-only binding for bridge endpoints.
2. Make approval workflow fail-closed by default.
3. Replace or harden file-based gate signaling with nonce-bound integrity checks.
4. Add schema validation/rate/size limits for all mutable inputs.
5. Redact sensitive logs and add security-focused tests for the above controls.

## Test coverage gaps (security)
No tests currently assert:
- Unauthorized client rejection for REST/Socket.io.
- Fail-closed behavior on timeout/invalid approval gate values.
- Config schema enforcement and boundary handling.
- Protection against stale/tampered gate file contents.
