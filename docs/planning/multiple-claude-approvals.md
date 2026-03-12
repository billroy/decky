# Plan: Concurrent multi-session approval queue

## Problem

Two separate issues combine to make multi-session use broken:

**Issue 1 — Queue silently drops concurrent requests.**
The `duplicatePre` guard in `app.ts:270` drops any `PermissionRequest` that arrives while the bridge is already in `awaiting-approval` state. This was intended to prevent a single session from double-enqueuing the same event, but it's too broad: it also silently discards legitimate requests from parallel Code sessions running in different repos. Only the first session's request reaches the StreamDeck.

**Issue 2 — Approve clicks the wrong Claude window.**
`clickApprovalButtonInTargetApp` in `macro-exec-darwin.ts:343` targets `front window` of the Claude process. With multiple Claude sessions open, activating Claude brings whichever window was last interacted with to the foreground — not necessarily the one with the active permission dialog. So even if the queue were fixed, Approve would click the wrong window.

Both issues must be fixed together for the feature to be viable.

---

## Solution

### Part A: Fix the approval queue

#### 1. `bridge/src/app.ts`

**a. Extend `ApprovalQueueItem` (lines 83–89):**
```typescript
interface ApprovalQueueItem {
  id: string;
  flow: ApprovalFlow;
  nonce: string | null;
  sessionId: string | null;   // ADD — from body.session_id
  cwd: string | null;          // ADD — from body.cwd
  tool: string | null;
  createdAt: number;
}
```

**b. Extract `session_id` and `cwd` in the `/hook` route (after line 383):**
```typescript
const sessionId = typeof body.session_id === "string" ? body.session_id : null;
const cwd = typeof body.cwd === "string" ? body.cwd : null;
```
Pass both through `applyHookPayload` options and into `enqueueApprovalRequest`.

**c. Replace `duplicatePre` guard with nonce-based dedup (lines 270–284):**

Remove:
```typescript
const duplicatePre = current.state === "awaiting-approval";
if (!duplicatePre) {
  enqueueApprovalRequest({...});
}
```
Replace with:
```typescript
const alreadyQueued = nonce != null && approvalQueue.some(item => item.nonce === nonce);
if (!alreadyQueued) {
  enqueueApprovalRequest({ flow, nonce, sessionId, cwd, tool: payload.tool ?? null });
}
```
In mirror flow, each `pre-tool-use.sh` invocation generates a unique nonce, so concurrent sessions (different nonces) all enqueue; same-invocation duplicate POSTs (same nonce) are still suppressed.

**d. Extend `StatePayload` and `statePayload()` (lines 105–117, 215–228):**
```typescript
// StatePayload interface
approval: {
  pending: number;
  position: number;
  flow: ApprovalFlow;
  requestId: string;       // ADD
  sessionId: string | null; // ADD
  cwd: string | null;       // ADD
} | null;

// statePayload() function
approval: active ? {
  pending: approvalQueue.length,
  position: 1,
  flow: active.flow,
  requestId: active.id,        // ADD
  sessionId: active.sessionId, // ADD
  cwd: active.cwd,             // ADD
} : null,
```

#### 2. `bridge/src/state-machine.ts`

Add a no-op self-transition to suppress the "no transition" log spam when concurrent requests arrive:
```typescript
"awaiting-approval:PermissionRequest": "awaiting-approval",
```

#### 3. `plugin/src/bridge-client.ts` (lines 27–33)

Add `sessionId` and `cwd` to `StateSnapshot.approval`:
```typescript
approval?: {
  pending: number;
  position: number;
  targetApp: "claude" | "codex";
  flow: "gate" | "mirror";
  requestId: string;
  sessionId?: string | null;   // ADD
  cwd?: string | null;          // ADD
} | null;
```

#### 4. `plugin/src/layouts.ts`

Add `sessionId` and `cwd` to `ApprovalUiMeta` (lines 592–598) and update `approvalInfoSVG` (lines 600–613) to show the project name (basename of `cwd`) as the bottom label when `pending > 1`:

```typescript
// ApprovalUiMeta
sessionId?: string | null;   // ADD
cwd?: string | null;          // ADD

// approvalInfoSVG — replace hardcoded "Info" label
const project = (pending > 1 && approval?.cwd)
  ? approval.cwd.split("/").filter(Boolean).at(-1) ?? "Info"
  : "Info";
// Use `project` in the SVG <text> element for the bottom line
```

Result: slot 3 shows `☁ · 1/2` / `Bash` / `my-repo` so the user knows which session is active.

---

### Part B: Fix window targeting

#### `bridge/src/macro-exec-darwin.ts`

**The problem:** `clickApprovalButtonInTargetApp` calls `activate` on the Claude process (raising its last-used window), then targets `front window`. With multiple Claude windows, this hits the wrong one.

**The fix:** For the Claude approval path, search ALL windows for the one that has an active `AXDefaultButton` (the approval dialog), raise that specific window with `AXRaise`, and click there. Fall back to the existing `front window` strategy only if the search fails.

Add a new internal helper `clickApprovalButtonInWindow` (or extend the existing function with an `searchAllWindows` flag):

```applescript
-- New first-attempt strategy for Claude approval:
tell application "System Events"
  tell process "Claude"
    if (count of windows) is 0 then return "no-window"
    repeat with w in windows
      try
        set btn to first button of w whose subrole is "AXDefaultButton"
        perform action "AXRaise" of w
        delay 0.05
        click btn
        return "clicked"
      end try
      try
        set btn to first button of sheet 1 of w whose subrole is "AXDefaultButton"
        perform action "AXRaise" of w
        delay 0.05
        click btn
        return "clicked"
      end try
    end repeat
    return "not-found"
  end tell
end tell
```

This approach:
- Does NOT call `activate` at the app level (avoids bringing the wrong window to front)
- Iterates all windows and sheets to find the one with an active approval dialog
- Uses `AXRaise` to surface only the specific window that has the dialog
- Requires no prior knowledge of window title or session ID
- Works for single-session use as well (no regression)
- Handles the case where two sessions simultaneously show dialogs (clicks whichever is found first — acceptable behavior)

**Implementation location:** Modify `approveInTargetApp("claude")` (line 215) to use this all-windows search as the primary strategy before falling back to the existing strategies. The dismiss path (`dismissClaudeApproval`) should get the same treatment.

---

## Tests

### `bridge/src/__tests__/multi-provider-queue.test.ts`

Update the test at lines 110–121 ("does NOT surface again for duplicate hook request"):
- **Split into two tests:**
  1. *Same nonce → deduped*: POST same nonce twice → one queue entry, surface called once.
  2. *Different nonces → both queued*: POST two PermissionRequests with different nonces → `pending: 2`, state stays `awaiting-approval`, surface called for each as it becomes active.

Add new describe block "concurrent sessions — queue lifecycle":
- Two PermissionRequests with different nonces both enqueue → `pending: 2`
- `statePayload.approval.cwd` reflects active session's cwd
- Approve first → `pending: 1`, still `awaiting-approval`, active cwd updates
- Approve second → queue empty, returns to `idle`

### `bridge/src/__tests__/macro-exec.test.ts` (or new file)

Add test for the all-windows search AppleScript path:
- Mock `osascript` to simulate process with multiple windows; only window 2 has `AXDefaultButton`
- Verify the approval click targets window 2, not window 1

---

## Open questions

1. **Claude.app accessibility tree**: The all-windows search assumes Claude's permission dialogs expose `AXDefaultButton` on windows or sheets. This needs manual verification on the target macOS version. If Claude uses a custom dialog that doesn't set `AXDefaultButton`, the existing label-search fallback still applies.

2. **Race: two sessions show dialogs simultaneously**: If both sessions trigger approval at the exact same moment, the all-windows search will click whichever window appears first in the accessibility tree. This is non-deterministic but acceptable — one approval proceeds, the other waits for the next Deck press.

3. **Non-macOS platforms**: `macro-exec-win32.ts` and `macro-exec-linux.ts` have their own approval implementations. The window-targeting fix is macOS-specific; the queue fix (Part A) applies to all platforms.
