
# Todo 2 — Bug fixes, PI improvements, and new features

## Bug: Button display — shift content up
- Move all the content up a little bit. There is 2-3x more empty space at the top than the bottom, and the bottom labels are distorted by the plastic keycaps.

**Analysis:** All SVG generators use a 144x144 canvas. In `macroSVG`, icons sit at y=96 and labels at y=136 — pushing text into the keycap shadow zone at the bottom. The `roundedRect` helper centers symbols around y=82-88. Fix: shift all y-coordinates up by ~12-16px across macroSVG, roundedRect, toolInfoSVG, thinkingSVG, and emptySVG in `layouts.ts`. Quick change — adjust constants and visually verify.

---

## Bug: Theme dropdown shows "Light" when config is "Dark"
- Theme in config dark. Comes up dark correctly. But light is selected in the theme dropdown and selecting a theme does nothing.

**Analysis:** In `slot.ts:onPropertyInspectorDidAppear`, the configSnapshot sends `theme: cfg?.theme ?? "light"`. If `bridgeRef?.getLastConfig()` returns a config object without a `.theme` property (e.g., if the bridge strips it or the config.json doesn't include it), it defaults to "light" even though the plugin's runtime theme is dark. Need to verify the bridge config includes `theme` in its broadcast. Also: after clicking Save in PI, the bridge updates config and broadcasts `configUpdate` back — but the PI doesn't re-receive a snapshot, so the dropdown may appear stale. Fix: ensure theme is in the config round-trip, and optionally re-sync PI on configUpdate.

---

## Bug: "Extra title" when editing macro name
- I edited T2. Changing the title adds an extra title above the T2 title. There is no edit box that shows T2 that allows me to edit just the macro name.

**Analysis:** This is almost certainly caused by the StreamDeck **native title** feature. If you double-click a button in the StreamDeck configuration UI, it lets you set a native title that renders ON TOP of the custom SVG image. The plugin explicitly calls `setTitle("")` to clear native titles, but if the user manually sets one via the StreamDeck UI, it persists and overlays the SVG-rendered label — causing the "double title" effect. The "no edit box" complaint means the PI doesn't show the current macro name for an existing macro when first opened. Fix: verify configSnapshot includes existing macro labels. Consider adding `"TitleDisabled": true` to the manifest for the slot action if supported by SDK v2.

---

## Bug: "Add macro" label input seems non-functional
- When I "add macro" I get a label field. Typing in that field does nothing. Then there is a text to send field — is that how I edit the prompt?

**Analysis:** The input handler (`el.addEventListener("input", ...)`) correctly updates the in-memory `macros[idx].label` when you type. But there's no visual feedback beyond text appearing in the field — the button on the deck doesn't update live. The typing IS working; the user needs to fill in the label and text, then click Save. The "text to send" field IS the prompt that gets injected into Claude. Fix: add placeholder help text and maybe a brief inline explanation. Consider adding a "live preview" SVG next to each macro entry.

---

## Bug: Save button disabled
- After editing Save is disabled so I can't save changes.

**Analysis (revised):** The user confirms the bridge WAS running but Save was still disabled. This points to a **race condition**: when the PI opens, `onPropertyInspectorDidAppear` in slot.ts fires and sends a `configSnapshot` message. But if the PI's JavaScript hasn't finished loading its `sendToPropertyInspector.subscribe()` listener yet, the message arrives before the listener is ready and gets dropped. The PI never sets `configLoaded = true`, so Save stays disabled forever for that session.

**Root cause:** One-shot message delivery with no retry or readiness handshake.

**Fix:** Add a readiness handshake — have the PI send a "piReady" message to the plugin when its listener is subscribed, and have the plugin respond with the configSnapshot. This guarantees the PI is listening before the snapshot is sent. Alternatively, add a retry/poll: if `configLoaded` is still false after 500ms, re-request the snapshot.
---

## Explain: Editor field
- Also explain why I see an Editor control that seems to be prompting for an editor command.

**Answer (revised):** The Editor field is a **global setting** visible in the PI regardless of which slot you clicked — the PI is shared across all slot instances, not slot-specific. It specifies which command to run when you press an **empty** (unconfigured) macro slot on the deck: it runs `{editor} ~/.decky/config.json`. When a slot IS configured with a macro, the Editor setting has no effect on that slot — it only applies to empty/surplus slots beyond your macro count.

The Editor field is always visible because the PI shows all global settings (theme, editor, timeout) plus the full macro list. It does NOT disappear when you click a configured slot.

**Changes:**
- Change default from `"open"` to `"bbedit"` in slot.ts line 122 and bridge config defaults
- Add help text: "Editor command for opening config file (used by empty slots)"
- Consider hiding or de-emphasizing the Editor row since it's rarely needed once macros are configured via PI


---

## Explain: Approval Timeout
- Explain what approval timeout does.

**Answer:** When Claude Code requests approval to use a tool (file write, bash, etc.), the deck shows Approve/Deny/Cancel buttons. The approval timeout (in seconds) sets how long the system waits for a response. If no button is pressed within the timeout, the tool request is automatically denied to prevent Claude from hanging indefinitely. Default is 30 seconds. Fix: add a descriptive subtitle in PI: "Auto-deny tool requests after this many seconds of no response".

---

## Feature: Property Inspector Colors
- Add page-level default color controls for the background, text, and icon.
- Add macro-level override controls to override the page default.
- Allow selection from a small palette of 8 colors for each.

**Analysis:** Currently there are two hard-coded theme palettes (light/dark) in `layouts.ts`. This feature would replace/extend the theme system with user-chosen colors. Recommendation: use a compact color swatch picker (8 preset colors shown as clickable circles) rather than a full color picker, keeping the PI simple. Store defaults in config as `colors: { bg, text, icon }` and per-macro as `macro.colors: { bg?, text?, icon? }` (null = use default). Wire through to `macroSVG()` which already parameterizes colors via `ThemePalette`.

**Suggested 8-color palette:**
- `#0f172a` (dark navy), `#1e3a5f` (blue), `#22c55e` (green), `#ef4444` (red)
- `#f59e0b` (amber), `#8b5cf6` (purple), `#ffffff` (white), `#64748b` (slate)

---

## Feature: Improve Icon Selection
- Recommend additional icons. Consider onboarding an icon package. How hard is the color-changing icon issue?

**Analysis:** Currently 4 options: none, checkmark (✓), stop (⬣), exclamation (!). All are Unicode characters rendered in SVG `<text>` elements with hard-coded fill colors (green, red, amber). Expanding icons is straightforward since they're just SVG — can use inline SVG paths instead of Unicode text for better rendering.

**Options:**
1. **Expand Unicode set** (easiest, ~20 min): Add ⚡ ⚙ ✎ ★ ↻ ⏎ 🔒 📁 etc. Some Unicode renders poorly at small sizes.
2. **Embed SVG path icons** (moderate, ~40 min): Use Lucide or Feather icon SVG paths inline. Crisp at any size, fully color-controllable. ~20-30 icons would cover most needs. No package dependency — just copy the SVG path data.
3. **Full icon package** (heaviest): Bundle an icon font or SVG sprite sheet. Overkill for a StreamDeck plugin.

**Recommendation:** Option 2 — embed ~20 Lucide SVG paths. Color-changing is trivial: just change the `stroke` or `fill` attribute in the SVG. This integrates naturally with the color feature above.

**Icon names:** Lucide icons have canonical kebab-case names from the Lucide project (https://lucide.dev/icons/). Each icon is an SVG with a standardized 24x24 viewBox. We'd copy just the SVG `<path>` data into a lookup map in `layouts.ts`, keyed by the Lucide name. Examples: `"check"`, `"circle-stop"`, `"alert-triangle"`, `"zap"`, `"settings"`, `"pencil"`, `"star"`, `"refresh-cw"`, `"corner-down-left"`, `"lock"`, `"folder"`, `"play"`, `"pause"`, `"send"`, `"terminal"`, `"code"`, `"git-branch"`, `"bug"`, `"rocket"`, `"thumbs-up"`. The PI dropdown would show these names with a small preview. The icon name stored in config (e.g. `"icon": "zap"`) maps directly to the Lucide name — no translation layer needed.
---

# Implementation Tranches (20 minutes each)

## Tranche 1: SVG positioning fix
- Shift y-coordinates up by ~14px in all SVG generators in `layouts.ts`
  - `roundedRect`: symbol y 88→74, adjust fontSize thresholds
  - `macroSVG` with icon: icon y 96→82, label y 136→122
  - `macroSVG` no icon: play y 86→72, label y 136→122
  - `toolInfoSVG`: "Tool" y 60→48, name y 100→86
  - `thinkingSVG`: circles cy 72→62
  - `emptySVG`: dots y 82→70
- Update layout tests to match new coordinates
- Build and visual check on deck

## Tranche 2: PI bug fixes — save race condition, theme, help text
- Fix PI↔plugin handshake: add "piReady" message from PI, plugin responds with configSnapshot (fixes Save-disabled race condition)
- Debug theme round-trip: verify bridge config includes `theme` field in broadcasts
- Fix PI theme dropdown sync on initial load
- Change default editor from "open" to "bbedit" in slot.ts and bridge config defaults
- Add descriptive subtitles for Editor ("Editor command for config file, used by empty slots") and Approval Timeout ("Auto-deny after N seconds of no response")
- Add help text for "Text to send" field ("Prompt text injected into Claude")
- Show connection status in PI (connected/disconnected indicator)

## Tranche 3: PI bug fixes — macro editing, native title
- Investigate and fix "extra title" (native title overlay) — suppress via `setTitle("")` on config change or manifest flag
- Verify new macro label input works (may be a misunderstanding — add inline guidance)
- Ensure existing macro labels populate correctly on PI open
- Add brief instructions panel at top of Macros section

## Tranche 4: Color controls — config & PI
- Extend config schema: `colors: { bg, text, icon }` defaults + per-macro `colors` override
- Add color swatch picker component to PI (8-color palette, clickable circles)
- Add "Default Colors" section to PI above macro list
- Add per-macro color override row (collapsed by default)
- Wire Save/Load for color data

## Tranche 5: Color controls — rendering
- Update `ThemePalette` and `macroSVG` to accept color overrides
- Wire `getSlotConfig` to pass colors from config through to SVG generators
- Update bridge config schema (bridge side)
- Update tests
- Build and visual verify

## Tranche 6: Icon selection expansion
- Select ~20 Lucide SVG path icons suitable for macro buttons
- Create icon path data map in `layouts.ts`
- Update `macroSVG` to render SVG paths instead of Unicode text
- Update PI icon dropdown with new options (grouped by category)
- Wire icon color to the color system from Tranche 4-5
- Update tests
