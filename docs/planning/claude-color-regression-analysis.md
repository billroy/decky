# Color Change Regression Analysis

## Bug Report

1. Click a button in the Stream Deck app (rainbow or random theme active)
2. Change its global color — only one button's preview updates, not all
3. Change its local (per-macro) color — nothing happens
4. Other themes work fine

## Root Cause

`macroSVG()` at `plugin/src/layouts.ts:404-410` unconditionally suppresses all color
overrides when the theme is `rainbow` or `random`:

```typescript
const dynamicTheme = currentTheme === "rainbow" || currentTheme === "random";
const pageBg = dynamicTheme ? undefined : defaultColors.bg;
const pageText = dynamicTheme ? undefined : defaultColors.text;
const pageIcon = dynamicTheme ? undefined : defaultColors.icon;
const macroBgOverride = dynamicTheme ? undefined : colors?.bg;
const macroTextOverride = dynamicTheme ? undefined : colors?.text;
const macroIconOverride = dynamicTheme ? undefined : colors?.icon;
```

When `dynamicTheme` is true, all six override variables are forced to `undefined`.
`resolveColor(base, undefined, undefined)` always returns the theme's base palette
color, ignoring any user-set colors.

### Why global color updates exactly one button

`widgetSVG()` at `layouts.ts:617-618` does NOT have this guard:

```typescript
const bg = resolveColor(p.macroBg, defaultColors.bg, undefined);
const fg = resolveColor(p.macroLabel, defaultColors.text, undefined);
```

It passes `defaultColors.bg`/`.text` directly regardless of theme. So a widget-type
button responds to global color changes even in rainbow/random themes, while all
other buttons (rendered through `macroSVG`) ignore them.

### Why local color does nothing

Per-macro overrides (`colors?.bg`, etc.) are also suppressed by the same
`dynamicTheme` ternary. The user's color selection is saved to the bridge correctly
but never reaches the SVG output.

## Proposed Fix

The dynamic theme guard was intended to let the per-slot palette distribution
(rainbow hues, random colors) show through by default. But explicit user overrides
should take precedence — if a user sets a color, that choice should be honored
regardless of theme.

In `macroSVG()` at `layouts.ts:404-410`, allow user overrides to win:

```typescript
const dynamicTheme = currentTheme === "rainbow" || currentTheme === "random";
const pageBg = dynamicTheme ? undefined : defaultColors.bg;
const pageText = dynamicTheme ? undefined : defaultColors.text;
const pageIcon = dynamicTheme ? undefined : defaultColors.icon;
const macroBgOverride = colors?.bg;      // always respect per-macro overrides
const macroTextOverride = colors?.text;
const macroIconOverride = colors?.icon;
```

This preserves the original intent for page-level defaults (dynamic themes ignore
blanket page colors so the per-slot palette shows through) while honoring explicit
per-macro color choices. If page-level overrides should also be respected, remove
the `dynamicTheme` guard from those three lines as well.

Also apply the same pattern in `widgetSVG()` for consistency (it currently always
uses page defaults, which is the correct behavior).

## Secondary Issue: Missing `config` in `updateConfigAck`

The bridge at `bridge/src/app.ts:294` does not include the saved `config` object in
the `updateConfigAck` payload. The plugin's `bridge-client.ts:157-168` only fires
`configListeners` from the ack handler if `payload.config` exists. This is not the
cause of the reported bug (the `configUpdate` broadcast at `app.ts:293` independently
triggers re-renders via `bridge-client.ts:149`), but it reduces robustness — if the
broadcast is delayed or dropped, the ack path cannot compensate. Adding `config` to
the ack payload is a good defensive improvement.
