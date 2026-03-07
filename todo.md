
TODO:

- B1: Increase max macros to 36 for the new big deck product.  Q: do you need to know the buttons-wide vs buttons-high for the layout?  if so research online at www.elgato.com.

  COMMENT: The Stream Deck Studio has 32 LCD keys in a horizontal bar form factor
  (designed for 19" rack mounting). The SDK reports device dimensions via
  `ev.action.device.size.columns` and `.rows`, so the existing coordinate-based
  slot assignment (`row * columns + column`) will work automatically -- no code
  change needed for layout geometry. The only change required is raising the cap
  in `buildIdleLayout()` from `i < 15` to `i < 36` in `plugin/src/layouts.ts:156`.
  Straightforward -- ~1 line change + test update. Note: the SDK already handles
  the Studio as device type 10 with the same key API.

- B2: add a theme selector to config.json and name the current theme 'light'.  add a 'dark' theme with a black background and white type, same icons.  ensure that legacy configurations default to light if there is no theme specified in the config.json.

  COMMENT: Moderate effort. Changes needed:
  1. `bridge/src/config.ts` -- add `theme?: "light" | "dark"` to DeckyConfig,
     default to "light", pass through on configUpdate events
  2. `plugin/src/layouts.ts` -- `macroSVG()` and the default-style SVG need
     theme-aware colors (bg, text fill, icon colors for dark). The icon SVGs
     (checkmark, stop, exclamation) currently use white backgrounds with colored
     symbols -- dark theme would invert to dark bg with the same colored symbols
     and light text. Roughly doubles the SVG generation paths or adds a color
     palette lookup.
  3. `plugin/src/actions/slot.ts` -- pass theme through to `getSlotConfig()`
  4. Tests: add dark-theme variants for SVG assertions
  Estimate: ~50-80 lines of changes across 3 files + tests.

- B2.1: Make the current contents of my config the default config.json seed setting.  Add an explicit selector for "theme": "light".

  COMMENT: Easy. Update `DEFAULT_CONFIG` in `bridge/src/config.ts` to match
  current `~/.decky/config.json` contents (13 macros + theme field). Add
  `theme: "light"` to the interface and default. Should be done as part of B2
  since the theme field needs to exist first. Could also do standalone by just
  updating the default macros list now and adding theme in B2.

- B3: Increase the icon size and type size a little.  There is a lot of white space that feels unused.

  COMMENT: Easy. Adjust font-size values in `macroSVG()` in
  `plugin/src/layouts.ts`. Current sizes: checkmark 84, stop 90, exclamation 90,
  play 48, labels 22/28. Could bump icons to ~100 and labels to ~26/32.
  The label y-position (currently 130) may need shifting down toward 136 to
  reclaim vertical space. Pure SVG tweaking -- ~5 lines.

- B4: Is it possible to have the unused icons open the config.json in bbedit using "bbedit ~/.decky/config.json" when they are clicked?

  COMMENT: Yes, with a caveat. Currently, EMPTY slots have no `action` field so
  `onKeyDown` ignores them. We could add a special action like `"openConfig"`.
  The plugin runs inside the Stream Deck process (Node.js), and
  `child_process.exec("bbedit ~/.decky/config.json")` would run on the local
  machine. This works since the plugin IS a local Node.js process.
  Implementation:
  1. Give EMPTY slots `action: "openConfig"` in layouts.ts
  2. In slot.ts `onKeyDown`, detect `"openConfig"` and exec bbedit directly
     (no bridge round-trip needed)
  3. Could make the editor command configurable in config.json (e.g.,
     `"editor": "bbedit"`) for portability
  ~15 lines of code. One concern: Stream Deck SDK sandboxing -- need to verify
  that child_process.exec works in the plugin context (it should, since the
  plugin already uses Node.js APIs freely).

- B5: Investigate whether there's a way to automatically detect the context switch when Claude.app brings up an approval button, and have a decky button change state to enabled that can then push the approval button.  More generally, can the claude.app context switches be detected from the event stream and what hooks do we have to detect context changes in the UI and enable/disable elements when they happen?

  COMMENT: This is about Claude Desktop (the Electron app), not Claude Code CLI.
  Decky currently works with Claude Code's hook system (pre-tool-use,
  post-tool-use, etc.) which fires shell scripts that POST to our bridge.
  This is how we already detect approval states.

  For Claude Desktop app (Claude.app):
  - There is NO official hook/event API for Claude Desktop as of March 2026.
    Claude Desktop doesn't expose tool-use approval events the way Claude Code does.
  - Possible workarounds (all fragile):
    a) macOS Accessibility API -- monitor Claude.app's window for the approval
       button appearing. Very brittle, breaks on UI updates.
    b) Screen scraping -- periodically screenshot and OCR. Even more fragile.
    c) AppleScript/JXA -- query Claude.app's UI elements. Only works if the app
       exposes accessibility metadata.
    d) MCP server -- if Claude Desktop supports tool-use hooks in the future,
       that would be the clean path.

  For Claude Code CLI (what Decky already supports):
  - We already detect approval states via hooks. The `awaiting-approval` state
    triggers the Approve/Deny/Cancel buttons on the deck. This works today.

  Recommendation: Not feasible for Claude Desktop without an official API.
  For Claude Code, it already works. If Anthropic adds a hook system to Claude
  Desktop in the future, we could extend the bridge to listen for those events.
