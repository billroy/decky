/**
 * Layout definitions — maps each state to a set of slot configurations.
 *
 * Each slot index gets an icon (SVG), title, and optional action to
 * send to the bridge when pressed.
 */

export interface SlotConfig {
  svg: string;
  title: string;
  action?: string;
  data?: Record<string, unknown>;
}

export type LayoutDef = Record<number, SlotConfig>;
export type TargetApp = "claude" | "codex" | "chatgpt" | "cursor" | "windsurf";

// --- Theme palettes ---

export type Theme = "light" | "dark";

interface ThemePalette {
  macroBg: string;
  macroLabel: string;
  defaultBg: string;
  defaultIcon: string;
  defaultLabel: string;
  emptyBg: string;
  emptyText: string;
}

const PALETTES: Record<Theme, ThemePalette> = {
  light: {
    macroBg: "#ffffff",
    macroLabel: "#1e293b",
    defaultBg: "#1e3a5f",
    defaultIcon: "#64748b",
    defaultLabel: "#e2e8f0",
    emptyBg: "#1e293b",
    emptyText: "#475569",
  },
  dark: {
    macroBg: "#0f172a",
    macroLabel: "#e2e8f0",
    defaultBg: "#0f172a",
    defaultIcon: "#475569",
    defaultLabel: "#94a3b8",
    emptyBg: "#0f172a",
    emptyText: "#334155",
  },
};

let currentTheme: Theme = "light";
let showTargetBadge = false;
let defaultTargetApp: TargetApp = "claude";

const TARGET_CODES: Record<TargetApp, string> = {
  claude: "CLD",
  codex: "CDX",
  chatgpt: "CGP",
  cursor: "CSR",
  windsurf: "WDF",
};

const TARGET_BADGE_COLORS: Record<TargetApp, { bg: string; text: string }> = {
  claude: { bg: "#f59e0b", text: "#111827" },
  codex: { bg: "#10b981", text: "#052e16" },
  chatgpt: { bg: "#22c55e", text: "#052e16" },
  cursor: { bg: "#60a5fa", text: "#082f49" },
  windsurf: { bg: "#a78bfa", text: "#2e1065" },
};

export function setTheme(theme: Theme): void {
  currentTheme = theme;
}

export function getTheme(): Theme {
  return currentTheme;
}

export function setTargetBadgeOptions(options: {
  showTargetBadge: boolean;
  defaultTargetApp: TargetApp;
}): void {
  showTargetBadge = options.showTargetBadge;
  defaultTargetApp = options.defaultTargetApp;
}

function targetBadge(targetApp?: TargetApp): string {
  if (!showTargetBadge) return "";
  const target = targetApp ?? defaultTargetApp;
  const palette = TARGET_BADGE_COLORS[target];
  return `<g>
    <rect x="6" y="6" width="34" height="14" rx="3" fill="${palette.bg}" opacity="0.95" />
    <text x="23" y="16" font-size="8" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="${palette.text}">${TARGET_CODES[target]}</text>
  </g>`;
}

// --- SVG generators ---

function roundedRect(color: string, symbol: string, fontSize = 64): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${color}" />
    <text x="72" y="${fontSize > 40 ? 76 : 70}" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="white">${symbol}</text>
  </svg>`;
}

/** Default icon colors for legacy Unicode icons. */
const ICON_COLORS: Record<string, string> = {
  checkmark: "#22c55e",
  stop: "#ef4444",
  exclamation: "#f59e0b",
};

/** Unicode symbols for legacy icon types. */
const ICON_SYMBOLS: Record<string, string> = {
  checkmark: "\u2713",
  stop: "\u2B23",
  exclamation: "!",
};

/**
 * Lucide SVG path icons — inner elements from the Lucide icon set.
 * Rendered with stroke-based styling in a 24x24 viewBox.
 * Names are canonical Lucide kebab-case identifiers.
 */
const LUCIDE_ICONS: Record<string, string> = {
  "check": '<path d="M20 6 9 17l-5-5" />',
  "x": '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
  "circle-stop": '<circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" rx="1" />',
  "triangle-alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />',
  "zap": '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />',
  "settings": '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" />',
  "pencil": '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
  "star": '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />',
  "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />',
  "corner-down-left": '<path d="M20 4v7a4 4 0 0 1-4 4H4" /><path d="m9 10-5 5 5 5" />',
  "lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />',
  "folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
  "play": '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
  "pause": '<rect x="14" y="3" width="5" height="18" rx="1" /><rect x="5" y="3" width="5" height="18" rx="1" />',
  "send": '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" />',
  "terminal": '<path d="M12 19h8" /><path d="m4 17 6-6-6-6" />',
  "code": '<path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" />',
  "git-branch": '<path d="M15 6a9 9 0 0 0-9 9V3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />',
  "bug": '<path d="M12 20v-9" /><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" /><path d="M14.12 3.88 16 2" /><path d="M21 21a4 4 0 0 0-3.81-4" /><path d="M21 5a4 4 0 0 1-3.55 3.97" /><path d="M22 13h-4" /><path d="M3 21a4 4 0 0 1 3.81-4" /><path d="M3 5a4 4 0 0 0 3.55 3.97" /><path d="M6 13H2" /><path d="m8 2 1.88 1.88" /><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />',
  "rocket": '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" /><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" />',
  "thumbs-up": '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /><path d="M7 10v12" />',
};

/** Export icon names for use by PI. */
export function getLucideIconNames(): string[] {
  return Object.keys(LUCIDE_ICONS);
}

function macroSVG(label: string, icon?: string, colors?: ColorOverrides, targetApp?: TargetApp): string {
  const p = PALETTES[currentTheme];
  const displayLabel = label.length > 10 ? label.slice(0, 9) + "\u2026" : label;
  const fontSize = displayLabel.length > 6 ? 26 : 32;

  // Resolve colors: macro overrides > page defaults > theme palette
  const bg = colors?.bg ?? defaultColors.bg;
  const textColor = colors?.text ?? defaultColors.text;
  const iconColor = colors?.icon ?? defaultColors.icon;

  // Lucide SVG path icon
  if (icon && LUCIDE_ICONS[icon]) {
    const resolvedBg = bg ?? p.macroBg;
    const resolvedIcon = iconColor ?? p.macroLabel;
    const resolvedText = textColor ?? p.macroLabel;
    return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
      <rect width="144" height="144" rx="16" fill="${resolvedBg}" />
      <g transform="translate(36, 10) scale(3)" fill="none" stroke="${resolvedIcon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LUCIDE_ICONS[icon]}</g>
      <text x="72" y="122" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="${resolvedText}">${displayLabel}</text>
      ${targetBadge(targetApp)}
    </svg>`;
  }

  // Legacy Unicode icon (checkmark, stop, exclamation)
  if (icon && ICON_SYMBOLS[icon]) {
    const symbol = ICON_SYMBOLS[icon];
    const resolvedBg = bg ?? p.macroBg;
    const resolvedIcon = iconColor ?? ICON_COLORS[icon] ?? p.defaultIcon;
    const resolvedText = textColor ?? p.macroLabel;
    const fontWeight = icon === "exclamation" ? ' font-weight="bold"' : "";
    return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
      <rect width="144" height="144" rx="16" fill="${resolvedBg}" />
      <text x="72" y="82" font-size="100" font-family="sans-serif" text-anchor="middle" fill="${resolvedIcon}"${fontWeight}>${symbol}</text>
      <text x="72" y="122" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="${resolvedText}">${displayLabel}</text>
      ${targetBadge(targetApp)}
    </svg>`;
  }

  // Default: no icon — play arrow style
  const resolvedBg = bg ?? p.defaultBg;
  const resolvedIcon = iconColor ?? p.defaultIcon;
  const resolvedText = textColor ?? p.defaultLabel;
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${resolvedBg}" />
    <text x="72" y="72" font-size="60" font-family="sans-serif" text-anchor="middle" fill="${resolvedIcon}">\u25B6</text>
    <text x="72" y="122" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="${resolvedText}">${displayLabel}</text>
    ${targetBadge(targetApp)}
  </svg>`;
}

function toolInfoSVG(toolName: string): string {
  const displayName = toolName.length > 8 ? toolName.slice(0, 7) + "\u2026" : toolName;
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="#1e293b" />
    <text x="72" y="48" font-size="20" font-family="sans-serif" text-anchor="middle" fill="#94a3b8">Tool</text>
    <text x="72" y="86" font-size="32" font-family="sans-serif" text-anchor="middle" fill="#e2e8f0">${displayName}</text>
  </svg>`;
}

function thinkingSVG(): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="#1e293b" />
    <circle cx="50" cy="62" r="10" fill="#3b82f6" opacity="0.9" />
    <circle cx="72" cy="62" r="10" fill="#3b82f6" opacity="0.6" />
    <circle cx="94" cy="62" r="10" fill="#3b82f6" opacity="0.3" />
  </svg>`;
}

function emptySVG(): string {
  const p = PALETTES[currentTheme];
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
  <rect width="144" height="144" rx="16" fill="${p.emptyBg}" />
  <text x="72" y="70" font-size="36" font-family="sans-serif" text-anchor="middle" fill="${p.emptyText}">\u2022\u2022\u2022</text>
</svg>`;
}

// --- Slot config factories ---

const APPROVE: SlotConfig = {
  svg: roundedRect("#22c55e", "\u2713"),
  title: "Approve",
  action: "approve",
};

const DENY: SlotConfig = {
  svg: roundedRect("#ef4444", "\u2717"),
  title: "Deny",
  action: "deny",
};

const CANCEL: SlotConfig = {
  svg: roundedRect("#f59e0b", "\u23F9"),
  title: "Cancel",
  action: "cancel",
};

const STOP: SlotConfig = {
  svg: roundedRect("#ef4444", "\u23F9"),
  title: "Stop",
  action: "cancel",
};

const RESTART: SlotConfig = {
  svg: roundedRect("#22c55e", "\u21BB"),
  title: "Restart",
  action: "restart",
};

const THINKING: SlotConfig = {
  svg: thinkingSVG(),
  title: "Thinking\u2026",
};

export interface ColorOverrides {
  bg?: string;
  text?: string;
  icon?: string;
}

export interface MacroInput {
  label: string;
  text: string;
  icon?: string;
  colors?: ColorOverrides;
  targetApp?: TargetApp;
}

/** Page-level default colors, set from config. */
let defaultColors: ColorOverrides = {};

export function setDefaultColors(colors: ColorOverrides): void {
  defaultColors = colors;
}

function macroSlot(macro: MacroInput): SlotConfig {
  const targetApp = macro.targetApp ?? defaultTargetApp;
  return {
    svg: macroSVG(macro.label, macro.icon, macro.colors, targetApp),
    title: macro.label,
    action: "macro",
    data: { text: macro.text, targetApp },
  };
}

/** Default macros used when no config is available. */
const DEFAULT_MACROS: MacroInput[] = [
  { label: "Macro 1", text: "" },
  { label: "Macro 2", text: "" },
  { label: "Macro 3", text: "" },
  { label: "Macro 4", text: "" },
  { label: "Macro 5", text: "" },
  { label: "Macro 6", text: "" },
];

function emptySlot(): SlotConfig {
  return { svg: emptySVG(), title: "", action: "openConfig" };
}

// --- Layout definitions per state ---

function buildIdleLayout(macros: MacroInput[]): LayoutDef {
  const layout: LayoutDef = {};
  for (let i = 0; i < macros.length && i < 36; i++) {
    layout[i] = macroSlot(macros[i]);
  }
  return layout;
}

const LAYOUTS: Record<string, LayoutDef> = {
  thinking: {
    0: THINKING,
    1: STOP,
  },

  "awaiting-approval": {
    0: APPROVE,
    1: DENY,
    2: CANCEL,
  },

  "tool-executing": {
    0: STOP,
  },

  stopped: {
    0: RESTART,
  },
};

/**
 * Get the slot configuration for a given state and slot index.
 * Returns EMPTY for undefined slots.
 *
 * For tool-executing state, slot 1 shows the tool name if available.
 */
export function getSlotConfig(
  state: string,
  slotIndex: number,
  toolName?: string | null,
  macros?: MacroInput[],
): SlotConfig {
  // Idle state: render from macros (config-driven or defaults)
  if (state === "idle") {
    const macroList = macros ?? DEFAULT_MACROS;
    const idleLayout = buildIdleLayout(macroList);
    return idleLayout[slotIndex] ?? emptySlot();
  }

  // Special case: tool-executing slot 1 shows tool name
  if (state === "tool-executing" && slotIndex === 1 && toolName) {
    return { svg: toolInfoSVG(toolName), title: toolName };
  }

  // Special case: awaiting-approval slot 3 shows tool name
  if (state === "awaiting-approval" && slotIndex === 3 && toolName) {
    return { svg: toolInfoSVG(toolName), title: toolName };
  }

  const layout = LAYOUTS[state];
  if (!layout) return emptySlot();
  return layout[slotIndex] ?? emptySlot();
}

/** Get the full layout definition for a state. */
export function getLayout(state: string, macros?: MacroInput[]): LayoutDef {
  if (state === "idle") {
    return buildIdleLayout(macros ?? DEFAULT_MACROS);
  }
  return LAYOUTS[state] ?? {};
}

/** List all known states that have layout definitions. */
export function getLayoutStates(): string[] {
  return ["idle", ...Object.keys(LAYOUTS)];
}
