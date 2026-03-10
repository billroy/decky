# PI Test Strategy: Closed-Loop Automated Testing

## Problem

Agents cannot verify PI bug fixes because there is no way to confirm behavior
without manually clicking through the Stream Deck app. The PI is a 1300-line
self-contained HTML file that communicates over WebSocket. Bugs span three
boundaries (PI DOM ↔ WebSocket ↔ plugin ↔ bridge), and without automated tests
at each boundary, regressions slip through.

## Core Insight

The PI's `connectElgatoStreamDeckSocket(port, uuid, event, info, actionInfo)`
entry point is a plain WebSocket client. We can load the real PI HTML in
Playwright, start a mock WebSocket server on localhost, and call that function
to wire the PI to our mock. No Stream Deck app needed. No refactoring required.

This gives us a closed loop:
1. Mock sends `configSnapshot` → PI populates UI
2. Test interacts with DOM (click, type, select)
3. PI sends `updateConfig` over WebSocket → mock captures it
4. Mock sends ack (`configSnapshot`) → PI updates status
5. Test asserts final DOM state

## Technology Choices

| Tool | Role | Why |
|------|------|-----|
| **Playwright** (`@playwright/test`) | Browser test runner | Real browser, real WebSocket, real DOM events. No jsdom gaps. |
| **ws** (npm) | Mock WebSocket server | Lightweight, matches what Stream Deck daemon provides. |
| **vitest** | Unit tests (non-browser) | Already used in project for plugin/bridge tests. |

Playwright runs PI browser tests separately from vitest unit tests. Both run in
CI. No special integration needed.

### Why Not jsdom/happy-dom?

The PI relies on: WebSocket, pointer events, drag-and-drop, `scrollIntoView`,
clipboard API, and complex DOM rendering. jsdom stubs too many of these. We want
to test the actual runtime behavior, not a simulation of it.

### Why Not Extract PI to TypeScript Modules First?

Extracting the inline script to modules is a worthy goal but it's a large
refactor that itself needs test coverage to validate. The strategy here tests
the PI as-is — the same HTML that ships. Extraction can happen later as a
quality improvement, with the Playwright tests serving as the safety net.

## Architecture

```
┌─────────────────────────────────────┐
│  Playwright Test                    │
│                                     │
│  1. Start mock WS server (:random)  │
│  2. Navigate to PI HTML             │
│  3. Call connectElgatoStreamDeck...  │
│  4. Mock sends configSnapshot       │
│  5. Test interacts with DOM          │
│  6. Assert captured WS messages     │
│  7. Mock sends ack snapshot         │
│  8. Assert final DOM state          │
└──────────┬──────────────────────────┘
           │ WebSocket
           ▼
┌─────────────────────────────────────┐
│  Mock WS Server (in-process)        │
│                                     │
│  - Receives: registerPI, sendTo...  │
│  - Sends: sendToPropertyInspector   │
│  - Captures all messages for assert │
│  - Programmable responses           │
└─────────────────────────────────────┘
```

### Mock WebSocket Server API

```typescript
class MockStreamDeckServer {
  port: number;
  messages: Array<{ event: string; payload: any }>;

  constructor();
  start(): Promise<number>;       // returns random port
  stop(): Promise<void>;

  // Send a message to the PI as if from the plugin
  sendToPI(payload: object): void;

  // Wait for PI to send a specific message type
  waitForMessage(type: string, timeoutMs?: number): Promise<object>;

  // Get all captured sendToPlugin payloads
  getSentPayloads(): object[];

  // Clear captured messages
  clearMessages(): void;

  // Send a configSnapshot (convenience)
  sendConfigSnapshot(config: Partial<ConfigSnapshot>): void;
}
```

### Test Fixture: `piFixture`

A Playwright fixture that:
1. Creates a `MockStreamDeckServer`
2. Navigates to the PI HTML file (`file://` protocol)
3. Calls `connectElgatoStreamDeckSocket(port, uuid, 'registerPropertyInspector', '{}', actionInfo)`
4. Waits for the `piReady` message
5. Sends an initial `configSnapshot` with test data
6. Waits for `configLoaded === true` in the page
7. Provides helpers: `sendToPI()`, `waitForUpdate()`, `getPayloads()`

Teardown: stops mock server, closes page.

```typescript
// Usage in a test:
test('changing theme sends updateConfig', async ({ pi, mock }) => {
  await pi.selectOption('#theme', 'dracula');
  // Theme change opens apply panel; confirm it
  await pi.click('#btn-theme-apply-confirm');

  const msg = await mock.waitForMessage('updateConfig');
  expect(msg.theme).toBe('dracula');
});
```

## Test File Organization

```
plugin/
  tests/
    pi/
      fixtures/
        mock-server.ts        # MockStreamDeckServer class
        pi-fixture.ts         # Playwright test fixture
        defaults.ts           # Default configSnapshot for tests
      global-controls.spec.ts # Theme, timeout, badge, apply button
      macro-crud.spec.ts      # Add, remove, reorder macros
      macro-editing.spec.ts   # Label, text, icon, target app fields
      colors.spec.ts          # Page defaults, per-macro, reset buttons
      save-flow.spec.ts       # Apply, ack, timeout, error recovery
      scope.spec.ts           # Show all / show selected toggle
      drag-drop.spec.ts       # Macro reorder via drag
    playwright.config.ts      # Playwright config (uses file:// for PI)
```

Keep Playwright config minimal:
- No web server needed (load HTML via `file://`)
- Single browser (chromium) is sufficient
- Timeout: 5s per test (PI interactions are fast)

## Coverage Matrix

### Tier 1: Save Flow (highest bug density)

| Test | Interactions | Assertions |
|------|-------------|------------|
| Apply sends updateConfig | Click Apply | Payload matches expected fields |
| Ack disables Apply button | Apply → mock sends snapshot | `#btn-save` disabled |
| Ack timeout shows error | Apply → no response for 2s | Status shows error, Apply re-enabled |
| Dirty detection enables Apply | Change any field | `#btn-save` enabled |
| No-op when unchanged | Load config, click Apply | No message sent (or payload === baseline) |
| Error recovery | Timeout → edit → Apply again | New message sent, ack works |

### Tier 2: Global Controls

| Test | Interactions | Assertions |
|------|-------------|------------|
| Theme change opens panel | Select different theme | `.theme-apply-panel` visible |
| Theme apply modes | Select mode, confirm | Payload includes `themeApplyMode` |
| Theme cancel reverts | Cancel theme panel | `#theme` value restored |
| Random theme generates seed | Select random, confirm | Payload has `themeSeed` > 0 |
| Timeout value persists | Change timeout input | Payload `approvalTimeout` updated |
| Target badge toggle | Check/uncheck | Payload `showTargetBadge` toggled |

### Tier 3: Macro Editing

| Test | Interactions | Assertions |
|------|-------------|------------|
| Edit label updates payload | Type in label input | Macro label in payload |
| Edit text updates payload | Type in textarea | Macro text in payload |
| Select icon updates payload | Change icon dropdown | Macro icon in payload |
| Select target app | Change per-macro target | Macro targetApp in payload |
| Selected target app dropdown | Change #selected-target-app | Correct macro updated |
| Add macro | Click "+ Add Macro" | Payload has new empty macro |
| Remove macro | Click × button | Payload has one fewer macro |
| Max macro limit | Add 36 macros | Add button disabled |

### Tier 4: Colors

| Test | Interactions | Assertions |
|------|-------------|------------|
| Page default bg swatch | Click swatch in defaults | Payload `colors.bg` set |
| Per-macro bg swatch | Expand colors, click swatch | Macro `colors.bg` set |
| Reset page defaults | Click reset button | `colors` all empty |
| Reset all overrides | Click reset-all button | Page + macro colors empty |
| Custom color preserved | Load config with #abc123 | Custom swatch rendered |

### Tier 5: Scope & Navigation

| Test | Interactions | Assertions |
|------|-------------|------------|
| Show all / show selected | Toggle scope button | Correct macros visible |
| Selected slot from snapshot | Load with selectedMacroIndex=2 | Slot 3 shown |
| Scope button disabled | No selected index | Button disabled |

### Tier 6: Edge Cases & Regressions

| Test | Interactions | Assertions |
|------|-------------|------------|
| Target app + colors in same payload | Set both, apply | Both present in payload |
| Empty colors object clears defaults | Apply with `colors: {}` | Ack snapshot has no colors |
| Config snapshot idempotence | Send same snapshot twice | No UI state change |
| Background snapshot ignored | Unsolicited snapshot while editing | Edits preserved |
| piReady retry stops on load | Wait for configLoaded | piReady interval cleared |

## Default Test Config Snapshot

```typescript
export const DEFAULT_TEST_CONFIG = {
  type: 'configSnapshot',
  macros: [
    { label: 'Yes', text: '/yes', icon: 'checkmark', targetApp: 'claude' },
    { label: 'No', text: '/no', icon: 'x', targetApp: '' },
    { label: 'Build', text: 'npm run build', icon: 'terminal', targetApp: 'codex',
      colors: { bg: '#1e3a5f', text: '#ffffff', icon: '' } },
  ],
  theme: 'dark',
  themeSeed: 0,
  approvalTimeout: 30,
  defaultTargetApp: 'claude',
  showTargetBadge: true,
  selectedMacroIndex: 0,
  colors: { bg: '', text: '', icon: '' },
};
```

## Plugin-Side Tests (Vitest, No Browser)

Separately, add vitest unit tests for the plugin's `onSendToPlugin` handler in
`slot.ts`. These verify the plugin correctly relays PI messages to the bridge
and sends ack snapshots back. Use the existing mock patterns from
`bridge-client.test.ts`.

| Test | Setup | Assertions |
|------|-------|------------|
| piReady triggers sendConfigSnapshot | Mock SDK, emit piReady | `sendToPropertyInspector` called with configSnapshot |
| updateConfig relayed to bridge | Emit updateConfig payload | `sendAction('updateConfig', ...)` called on bridge client |
| Ack snapshot sent after bridge config update | Bridge emits stateChange after config | PI receives configSnapshot |

## Bridge-Side Tests (Vitest, Existing Pattern)

Add tests for config persistence round-trip:

| Test | Setup | Assertions |
|------|-------|------------|
| updateConfig persists to disk | POST config via socket | Read config file, verify fields |
| Config re-emitted on stateChange | Update config, trigger state | Snapshot includes new config |
| Invalid config rejected | POST malformed config | Error response, old config preserved |

## Implementation Sequence

### Step 1: Playwright Infrastructure (~1 hour)

1. `npm install -D @playwright/test ws @types/ws` in `plugin/`
2. Create `plugin/tests/pi/fixtures/mock-server.ts`
3. Create `plugin/tests/pi/fixtures/pi-fixture.ts`
4. Create `plugin/tests/pi/fixtures/defaults.ts`
5. Create `plugin/playwright.config.ts`
6. Add `"test:pi": "npx playwright test"` to `plugin/package.json`
7. Write one smoke test: load PI, receive configSnapshot, verify macro count

### Step 2: Save Flow Tests (~1 hour)

Write `save-flow.spec.ts` covering Tier 1. This is the highest-value target
since most PI bugs involve the save/ack cycle.

### Step 3: Macro & Global Control Tests (~1-2 hours)

Write `macro-editing.spec.ts`, `macro-crud.spec.ts`, and
`global-controls.spec.ts` covering Tiers 2-3.

### Step 4: Colors & Scope Tests (~1 hour)

Write `colors.spec.ts`, `scope.spec.ts` covering Tiers 4-5.

### Step 5: Regression Tests (~30 min)

Write targeted tests for known bugs (Tier 6), using git history to identify
past failure patterns.

### Step 6: CI Integration

Add `npm run test:pi` to the PR check workflow alongside existing `npm test`.

## Running Tests

```bash
# All PI tests
cd plugin && npx playwright test

# Specific suite
npx playwright test tests/pi/save-flow.spec.ts

# With UI (debug)
npx playwright test --ui

# Headed mode (watch the browser)
npx playwright test --headed
```

## How This Solves the Agent Problem

An agent fixing a PI bug can now:

1. **Reproduce**: Write a failing test that exercises the buggy behavior
2. **Fix**: Edit the PI HTML
3. **Verify**: Run `npx playwright test` — all tests must pass
4. **Regress**: Confirm no other tests broke

This is the same closed loop agents use successfully for server-side code. The
mock WebSocket server eliminates the Stream Deck app dependency entirely.

## What This Does NOT Cover

- **Visual appearance** (CSS styling, layout pixel-perfection): Use screenshot
  comparison if needed later, but functional correctness is the priority.
- **Real Stream Deck hardware**: Buttons, haptics, LED colors. These remain
  manual verification.
- **Bridge config file format evolution**: Covered by bridge-side vitest tests.
- **Network failures / reconnection**: The PI doesn't handle reconnection
  itself; the Stream Deck runtime does.
