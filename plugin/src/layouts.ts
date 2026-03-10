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

type ApprovalTargetApp = "claude" | "codex";

export type LayoutDef = Record<number, SlotConfig>;
export type TargetApp = "claude" | "codex" | "chatgpt" | "cursor" | "windsurf";
export type ConnectionStatus = "connected" | "disconnected" | "connecting";
export type WidgetKind = "bridge-status";
export type WidgetRefreshMode = "onClick" | "interval";
export interface WidgetDef {
  kind: WidgetKind;
  refreshMode?: WidgetRefreshMode;
  intervalMinutes?: number;
}
export type Theme =
  | "light"
  | "dark"
  | "dracula"
  | "monokai"
  | "solarized-dark"
  | "solarized-light"
  | "nord"
  | "github-dark"
  | "candy-cane"
  | "gradient-blue"
  | "wormhole"
  | "rainbow"
  | "random";

// --- Theme palettes ---

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
    defaultBg: "#ffffff",
    defaultIcon: "#64748b",
    defaultLabel: "#1e293b",
    emptyBg: "#ffffff",
    emptyText: "#64748b",
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
  dracula: {
    macroBg: "#282a36",
    macroLabel: "#f8f8f2",
    defaultBg: "#44475a",
    defaultIcon: "#8be9fd",
    defaultLabel: "#f8f8f2",
    emptyBg: "#1e1f29",
    emptyText: "#6272a4",
  },
  monokai: {
    macroBg: "#272822",
    macroLabel: "#f8f8f2",
    defaultBg: "#3e3d32",
    defaultIcon: "#a6e22e",
    defaultLabel: "#f8f8f2",
    emptyBg: "#1f201c",
    emptyText: "#75715e",
  },
  "solarized-dark": {
    macroBg: "#073642",
    macroLabel: "#93a1a1",
    defaultBg: "#002b36",
    defaultIcon: "#2aa198",
    defaultLabel: "#93a1a1",
    emptyBg: "#00212b",
    emptyText: "#586e75",
  },
  "solarized-light": {
    macroBg: "#fdf6e3",
    macroLabel: "#586e75",
    defaultBg: "#eee8d5",
    defaultIcon: "#268bd2",
    defaultLabel: "#586e75",
    emptyBg: "#e7dfcc",
    emptyText: "#93a1a1",
  },
  nord: {
    macroBg: "#2e3440",
    macroLabel: "#eceff4",
    defaultBg: "#3b4252",
    defaultIcon: "#88c0d0",
    defaultLabel: "#e5e9f0",
    emptyBg: "#242933",
    emptyText: "#4c566a",
  },
  "github-dark": {
    macroBg: "#0d1117",
    macroLabel: "#c9d1d9",
    defaultBg: "#161b22",
    defaultIcon: "#58a6ff",
    defaultLabel: "#c9d1d9",
    emptyBg: "#0b0f14",
    emptyText: "#6e7681",
  },
  "candy-cane": {
    macroBg: "#dc2626",
    macroLabel: "#ffffff",
    defaultBg: "#dc2626",
    defaultIcon: "#ffffff",
    defaultLabel: "#ffffff",
    emptyBg: "#dc2626",
    emptyText: "#ffffff",
  },
  "gradient-blue": {
    macroBg: "#0b2447",
    macroLabel: "#ffffff",
    defaultBg: "#0b2447",
    defaultIcon: "#ffffff",
    defaultLabel: "#ffffff",
    emptyBg: "#0b2447",
    emptyText: "#ffffff",
  },
  "wormhole": {
    macroBg: "#20242d",
    macroLabel: "#f8fafc",
    defaultBg: "#20242d",
    defaultIcon: "#f8fafc",
    defaultLabel: "#f8fafc",
    emptyBg: "#20242d",
    emptyText: "#f8fafc",
  },
  // Dynamic themes are computed per slot by resolveThemePaletteForSlot.
  rainbow: {
    macroBg: "#1e3a8a",
    macroLabel: "#ffffff",
    defaultBg: "#1e3a8a",
    defaultIcon: "#ffffff",
    defaultLabel: "#ffffff",
    emptyBg: "#0f172a",
    emptyText: "#64748b",
  },
  random: {
    macroBg: "#1e293b",
    macroLabel: "#e2e8f0",
    defaultBg: "#1e293b",
    defaultIcon: "#e2e8f0",
    defaultLabel: "#e2e8f0",
    emptyBg: "#0f172a",
    emptyText: "#64748b",
  },
};

let currentTheme: Theme = "light";
let currentThemeSeed = 0;
let showTargetBadge = false;

const TARGET_CODES: Record<TargetApp, string> = {
  claude: "CLD",
  codex: "CDX",
  chatgpt: "CGP",
  cursor: "CSR",
  windsurf: "WDF",
};

const TARGET_BADGE_COLORS: Record<TargetApp, { bg: string; text: string }> = {
  claude: { bg: "#C1502A", text: "#ffffff" },
  codex: { bg: "#5B6FD6", text: "#ffffff" },
  chatgpt: { bg: "#000000", text: "#ffffff" },
  cursor: { bg: "#3B2F8F", text: "#ffffff" },
  windsurf: { bg: "#0C6E6E", text: "#ffffff" },
};

export function setTheme(theme: Theme): void {
  currentTheme = PALETTES[theme] ? theme : (theme === "rainbow" || theme === "random" ? theme : "light");
}

export function getTheme(): Theme {
  return currentTheme;
}

export function setThemeSeed(seed: number): void {
  currentThemeSeed = Number.isFinite(seed) ? Math.floor(seed) : 0;
}

const RAINBOW_BG = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6"];
const RAINBOW_FG = ["#ffffff", "#111827", "#111827", "#052e16", "#083344", "#ffffff", "#f5f3ff"];
const RANDOM_SEED = 0x9e3779b1;

function hash32(value: number): number {
  let x = (value ^ RANDOM_SEED) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hslToHex(h: number, sPct: number, lPct: number): string {
  const s = Math.max(0, Math.min(100, sPct)) / 100;
  const l = Math.max(0, Math.min(100, lPct)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hh >= 0 && hh < 1) {
    r1 = c; g1 = x;
  } else if (hh < 2) {
    r1 = x; g1 = c;
  } else if (hh < 3) {
    g1 = c; b1 = x;
  } else if (hh < 4) {
    g1 = x; b1 = c;
  } else if (hh < 5) {
    r1 = x; b1 = c;
  } else {
    r1 = c; b1 = x;
  }
  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  const toHex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function randomColorFromIndex(index: number, channel: number): string {
  const h = hash32(index * 131 + channel * 911 + currentThemeSeed * 17);
  const hue = h % 360;
  const sat = 58 + ((h >>> 8) % 28); // 58..85
  const light = 30 + ((h >>> 16) % 36); // 30..65
  return hslToHex(hue, sat, light);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const clamped = Math.max(0, Math.min(1, t));
  return rgbToHex(
    ra.r + (rb.r - ra.r) * clamped,
    ra.g + (rb.g - ra.g) * clamped,
    ra.b + (rb.b - ra.b) * clamped,
  );
}

function srgbChannel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * srgbChannel(rgb.r) + 0.7152 * srgbChannel(rgb.g) + 0.0722 * srgbChannel(rgb.b);
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function ensureContrast(bg: string, candidate: string, minimum: number): string {
  if (contrastRatio(bg, candidate) >= minimum) return candidate;
  const fallbackPool = ["#ffffff", "#111827", "#f8fafc", "#0f172a"];
  let best = fallbackPool[0];
  let bestRatio = contrastRatio(bg, best);
  for (const option of fallbackPool.slice(1)) {
    const ratio = contrastRatio(bg, option);
    if (ratio > bestRatio) {
      best = option;
      bestRatio = ratio;
    }
  }
  return best;
}

function seededUnit(seed: number): number {
  return (hash32(seed) % 1000000) / 1000000;
}

function shuffledRainbow(): { bg: string; fg: string }[] {
  const pairs = RAINBOW_BG.map((bg, i) => ({ bg, fg: RAINBOW_FG[i] }));
  const out = pairs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const r = seededUnit(currentThemeSeed + i * 97);
    const j = Math.floor(r * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function resolveThemePaletteForSlot(theme: Theme, slotIndex: number): ThemePalette {
  if (theme === "candy-cane") {
    const stripe = Math.abs((slotIndex + currentThemeSeed) % 4);
    const bg = stripe % 2 === 0 ? "#dc2626" : "#f8fafc";
    const fg = ensureContrast(bg, stripe % 2 === 0 ? "#ffffff" : "#111827", 4.5);
    return {
      macroBg: bg,
      macroLabel: fg,
      defaultBg: bg,
      defaultIcon: fg,
      defaultLabel: fg,
      emptyBg: bg,
      emptyText: fg,
    };
  }
  if (theme === "gradient-blue") {
    const x = ((slotIndex % 5) + 5) % 5;
    const y = Math.floor(slotIndex / 5) % 3;
    const t = ((x / 4) + (y / 2)) / 2;
    const bg = mixHex("#0b2447", "#60a5fa", t);
    const fg = ensureContrast(bg, "#ffffff", 4.5);
    return {
      macroBg: bg,
      macroLabel: fg,
      defaultBg: bg,
      defaultIcon: fg,
      defaultLabel: fg,
      emptyBg: bg,
      emptyText: fg,
    };
  }
  if (theme === "wormhole") {
    const x = ((slotIndex % 5) + 5) % 5;
    const y = Math.floor(slotIndex / 5) % 3;
    const dx = x - 2;
    const dy = y - 1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const norm = Math.max(0, Math.min(1, dist / Math.sqrt(5)));
    const bg = hslToHex(220, 8 + norm * 12, 18 + norm * 58);
    const fg = ensureContrast(bg, norm > 0.6 ? "#111827" : "#f8fafc", 4.5);
    return {
      macroBg: bg,
      macroLabel: fg,
      defaultBg: bg,
      defaultIcon: fg,
      defaultLabel: fg,
      emptyBg: bg,
      emptyText: fg,
    };
  }
  if (theme === "rainbow") {
    const pairs = shuffledRainbow();
    const idx = ((slotIndex % pairs.length) + pairs.length) % pairs.length;
    const bg = pairs[idx].bg;
    const fg = pairs[idx].fg;
    return {
      macroBg: bg,
      macroLabel: fg,
      defaultBg: bg,
      defaultIcon: fg,
      defaultLabel: fg,
      emptyBg: bg,
      emptyText: fg,
    };
  }
  if (theme === "random") {
    const bg = randomColorFromIndex(slotIndex, 1);
    const textRaw = randomColorFromIndex(slotIndex, 2);
    const iconRaw = randomColorFromIndex(slotIndex, 3);
    const text = ensureContrast(bg, textRaw, 4.5);
    const icon = ensureContrast(bg, iconRaw, 4.5);
    return {
      macroBg: bg,
      macroLabel: text,
      defaultBg: bg,
      defaultIcon: icon,
      defaultLabel: text,
      emptyBg: bg,
      emptyText: text,
    };
  }
  const staticPalette = (PALETTES as Record<string, ThemePalette | undefined>)[String(theme)];
  return staticPalette ?? PALETTES.light;
}

export function setTargetBadgeOptions(options: {
  showTargetBadge: boolean;
  defaultTargetApp?: TargetApp;
}): void {
  showTargetBadge = options.showTargetBadge;
}

function targetBadge(targetApp?: TargetApp): string {
  if (!showTargetBadge) return "";
  if (!targetApp || targetApp === "claude") return "";
  const target = targetApp;
  const palette = TARGET_BADGE_COLORS[target];
  return `<g>
    <rect x="3" y="3" width="68" height="30" rx="7" fill="${palette.bg}" opacity="0.98" />
    <rect x="3.5" y="3.5" width="67" height="29" rx="6.5" fill="none" stroke="#000000" stroke-opacity="0.32" />
    <text x="37" y="25" font-size="13" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="${palette.text}">${TARGET_CODES[target]}</text>
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

const ICON_ALIASES: Readonly<Record<string, string>> = {
  checkmark: "check",
  stop: "octagon-x",
  exclamation: "triangle-alert",
  "circle-stop": "octagon-x",
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
  "octagon-x": '<path d="m7.86 2 8.28.01L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />',
  "ban": '<circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" />',
  "shield-off": '<path d="M20.42 4.58A1.94 1.94 0 0 0 19 4h-1V2" /><path d="M16.38 8.38A1 1 0 0 1 17 9.3V11a7 7 0 0 1-4.28 6.44" /><path d="M3.58 3.58 20.42 20.42" /><path d="M8 4H5a2 2 0 0 0-2 2v5a9 9 0 0 0 9 9 8.8 8.8 0 0 0 2-.23" />',
  "hand": '<path d="M18 11V6a2 2 0 0 0-4 0" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V5a2 2 0 0 0-4 0V14" /><path d="M6 14a2 2 0 0 0-2-2H3a1 1 0 0 0-1 1v1a8 8 0 0 0 8 8h2a8 8 0 0 0 8-8v-1.5a2.5 2.5 0 0 0-5 0V11" />',
  "clock-3": '<circle cx="12" cy="12" r="10" /><path d="M12 6v6h4" />',
  "timer-reset": '<path d="M10 2h4" /><path d="M12 14v-4" /><path d="M12 14l3 2" /><circle cx="12" cy="14" r="8" /><path d="M4 4 2 6" /><path d="M2 2 6 6" />',
  "message-square-warning": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M12 7v4" /><path d="M12 14h.01" />',
  "file-warning": '<path d="M14 2H6a2 2 0 0 0-2 2v16l4-2 4 2 4-2 4 2V8z" /><path d="M12 8v5" /><path d="M12 16h.01" />',
  "slash": '<circle cx="12" cy="12" r="10" /><path d="M4.5 19.5 19.5 4.5" />',
  "bell-off": '<path d="M8.56 2.31A6 6 0 0 1 18 7v4.2l1.8 3.6a1 1 0 0 1-.9 1.45H6.1" /><path d="M3 3 21 21" /><path d="M14.73 21a2 2 0 0 1-3.46 0" />',
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

function normalizeIcon(icon?: string): string | undefined {
  if (!icon) return undefined;
  const trimmed = icon.trim();
  if (!trimmed) return undefined;
  return ICON_ALIASES[trimmed] ?? trimmed;
}

function resolveLabelFontSize(displayLabel: string, fontSize?: number): number {
  if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
    return Math.max(16, Math.min(42, Math.floor(fontSize)));
  }
  return displayLabel.length > 7 ? 26 : 32;
}

function macroSVG(
  slotIndex: number,
  label: string,
  icon?: string,
  fontSizeOverride?: number,
  colors?: ColorOverrides,
  targetApp?: TargetApp,
): string {
  const p = resolveThemePaletteForSlot(currentTheme, slotIndex);
  const displayLabel = label.length > 10 ? label.slice(0, 9) + "\u2026" : label;
  const fontSize = resolveLabelFontSize(displayLabel, fontSizeOverride);
  const labelY = fontSize >= 36 ? 126 : 122;
  const normalizedIcon = normalizeIcon(icon);
  const dynamicTheme = currentTheme === "rainbow" || currentTheme === "random";
  const pageBg = defaultColors.bg;
  const pageText = defaultColors.text;
  const pageIcon = defaultColors.icon;
  const macroBgOverride = colors?.bg;
  const macroTextOverride = colors?.text;
  const macroIconOverride = colors?.icon;

  // Resolve colors: theme < page defaults < macro overrides
  const bg = resolveColor(p.macroBg, pageBg, macroBgOverride);
  const textColor = resolveColor(p.macroLabel, pageText, macroTextOverride);
  const iconColor = resolveColor(p.macroLabel, pageIcon, macroIconOverride);

  // Lucide SVG path icon
  if (normalizedIcon && LUCIDE_ICONS[normalizedIcon]) {
    return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
      <rect width="144" height="144" rx="16" fill="${bg}" />
      <g transform="translate(30, 16) scale(3.5)" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LUCIDE_ICONS[normalizedIcon]}</g>
      <text x="72" y="${labelY}" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="${textColor}">${displayLabel}</text>
      ${targetBadge(targetApp)}
    </svg>`;
  }

  // Legacy Unicode icon (checkmark, stop, exclamation)
  if (normalizedIcon && ICON_SYMBOLS[normalizedIcon]) {
    const symbol = ICON_SYMBOLS[normalizedIcon];
    const legacyDefaultIcon = dynamicTheme ? p.defaultIcon : (ICON_COLORS[normalizedIcon] ?? p.defaultIcon);
    const resolvedIcon = resolveColor(legacyDefaultIcon, pageIcon, macroIconOverride);
    const fontWeight = normalizedIcon === "exclamation" ? ' font-weight="bold"' : "";
    return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
      <rect width="144" height="144" rx="16" fill="${bg}" />
      <text x="72" y="82" font-size="100" font-family="sans-serif" text-anchor="middle" fill="${resolvedIcon}"${fontWeight}>${symbol}</text>
      <text x="72" y="${labelY}" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="${textColor}">${displayLabel}</text>
      ${targetBadge(targetApp)}
    </svg>`;
  }

  // Default: no icon — play arrow style
  // No explicit icon: still use macro palette so all macros in a theme are consistent.
  const resolvedBg = resolveColor(p.macroBg, pageBg, macroBgOverride);
  const resolvedIcon = resolveColor(p.defaultIcon, pageIcon, macroIconOverride);
  const resolvedText = resolveColor(p.macroLabel, pageText, macroTextOverride);
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${resolvedBg}" />
    <text x="72" y="72" font-size="60" font-family="sans-serif" text-anchor="middle" fill="${resolvedIcon}">\u25B6</text>
    <text x="72" y="${labelY}" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="${resolvedText}">${displayLabel}</text>
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

interface ApprovalUiMeta {
  pending: number;
  position: number;
  targetApp: "claude" | "codex";
  flow: "gate" | "mirror";
  requestId: string;
}

function approvalInfoSVG(toolName: string | null | undefined, approval: ApprovalUiMeta | null | undefined): string {
  const app: TargetApp = approval?.targetApp === "codex" ? "codex" : "claude";
  const palette = TARGET_BADGE_COLORS[app];
  const label = toolName && toolName.trim().length > 0 ? toolName.trim() : "Tool Approval";
  const display = label.length > 10 ? `${label.slice(0, 9)}…` : label;
  const pending = Math.max(1, Math.floor(approval?.pending ?? 1));
  const summary = pending > 1 ? `1/${pending}` : "1/1";
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${palette.bg}" />
    <text x="72" y="34" font-size="14" font-family="sans-serif" text-anchor="middle" fill="#ffffff" opacity="0.95">${TARGET_CODES[app]} · ${summary}</text>
    <text x="72" y="80" font-size="24" font-family="sans-serif" text-anchor="middle" fill="#ffffff">${display}</text>
    <text x="72" y="114" font-size="14" font-family="sans-serif" text-anchor="middle" fill="#ffffff" opacity="0.9">Info</text>
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

function emptySVG(slotIndex = 0, colors?: ColorOverrides): string {
  const p = resolveThemePaletteForSlot(currentTheme, slotIndex) ?? PALETTES.light;
  const emptyBg = resolveColor(p.emptyBg ?? PALETTES.light.emptyBg, defaultColors.bg, colors?.bg);
  const emptyText = resolveColor(p.emptyText ?? PALETTES.light.emptyText, defaultColors.text, colors?.text);
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
  <rect width="144" height="144" rx="16" fill="${emptyBg}" />
  <text x="72" y="70" font-size="36" font-family="sans-serif" text-anchor="middle" fill="${emptyText}">\u2022\u2022\u2022</text>
</svg>`;
}

// --- Animation frame helpers ---

/** Extract the inner content between the outer <svg> and </svg> tags. */
function extractSvgContent(svg: string): string {
  const match = svg.match(/^<svg[^>]*>([\s\S]*)<\/svg>\s*$/);
  return match ? match[1] : svg;
}

/**
 * Generate a slide-in animation frame.
 * Wraps the inner content of `targetSvg` at the given horizontal offset,
 * clipped to the 144×144 viewport over a black background.
 */
export function slideInFrame(targetSvg: string, xOffset: number): string {
  const inner = extractSvgContent(targetSvg);
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg" overflow="hidden">
  <rect width="144" height="144" fill="#000000"/>
  <g transform="translate(${xOffset}, 0)">
    ${inner}
  </g>
</svg>`;
}

/**
 * Generate a slide-out animation frame.
 * Wraps the inner content of `targetSvg` at the given vertical offset,
 * clipped to the 144×144 viewport over a black background.
 * Negative yOffset moves content upward (departure direction).
 */
export function slideOutFrame(targetSvg: string, yOffset: number): string {
  const inner = extractSvgContent(targetSvg);
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg" overflow="hidden">
  <rect width="144" height="144" fill="#000000"/>
  <g transform="translate(0, ${yOffset})">
    ${inner}
  </g>
</svg>`;
}

/** Pure black 144×144 SVG with no content — used for the clear phase before animations. */
export function blackSVG(): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
  <rect width="144" height="144" fill="#000000"/>
</svg>`;
}

// --- Approval button SVG generator ---
// Uses the same Lucide + label pipeline as macroSVG for uniform appearance.

function approvalButtonSVG(bg: string, iconName: string, label: string): string {
  const iconPath = LUCIDE_ICONS[iconName];
  const labelFontSize = resolveLabelFontSize(label);
  const labelY = labelFontSize >= 36 ? 126 : 122;
  if (iconPath) {
    return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
      <rect width="144" height="144" rx="16" fill="${bg}" />
      <g transform="translate(30, 16) scale(3.5)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>
      <text x="72" y="${labelY}" font-size="${labelFontSize}" font-family="sans-serif" text-anchor="middle" fill="#ffffff">${label}</text>
    </svg>`;
  }
  // Fallback to roundedRect if icon missing
  return roundedRect(bg, label, 32);
}

// --- Slot config factories ---

function approveSlot(): SlotConfig {
  return {
    svg: approvalButtonSVG("#22c55e", "check", "Approve"),
    title: "Approve",
    action: "approve",
    data: { targetApp: "claude" },
  };
}

function denySlot(): SlotConfig {
  return {
    svg: approvalButtonSVG("#ef4444", "x", "Deny"),
    title: "Deny",
    action: "deny",
    data: { targetApp: "claude" },
  };
}

function cancelSlot(): SlotConfig {
  return {
    svg: approvalButtonSVG("#f59e0b", "ban", "Cancel"),
    title: "Cancel",
    action: "cancel",
    data: { targetApp: "claude" },
  };
}

// Static references kept for action/data defaults used by macroSlot
const APPROVE: SlotConfig = {
  svg: "",
  title: "Approve",
  action: "approve",
  data: { targetApp: "claude" },
};

const DENY: SlotConfig = {
  svg: "",
  title: "Deny",
  action: "deny",
  data: { targetApp: "claude" },
};

const CANCEL: SlotConfig = {
  svg: "",
  title: "Cancel",
  action: "cancel",
  data: { targetApp: "claude" },
};

const STOP: SlotConfig = {
  svg: approvalButtonSVG("#ef4444", "octagon-x", "Stop"),
  title: "Stop",
  action: "cancel",
};

const RESTART: SlotConfig = {
  svg: approvalButtonSVG("#22c55e", "refresh-cw", "Restart"),
  title: "Restart",
  action: "restart",
};

const OPEN_CONFIG: SlotConfig = {
  svg: approvalButtonSVG("#0f172a", "settings", "Config"),
  title: "Config",
  action: "openConfig",
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
  fontSize?: number;
  colors?: ColorOverrides;
  targetApp?: TargetApp;
  submit?: boolean;
  type?:
    | "macro"
    | "widget"
    | "approve"
    | "deny"
    | "cancel"
    | "restart"
    | "openConfig"
    | "approveOnceInClaude"
    | "startDictationForClaude";
  widget?: WidgetDef;
}

/** Page-level default colors, set from config. */
let defaultColors: ColorOverrides = {};

export function setDefaultColors(colors: ColorOverrides): void {
  defaultColors = colors;
}

function sanitizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : undefined;
}

function resolveColor(base: string, pageOverride?: string, macroOverride?: string): string {
  return sanitizeColor(macroOverride) ?? sanitizeColor(pageOverride) ?? base;
}

function resolveApprovalTargetApp(targetApp?: TargetApp): ApprovalTargetApp {
  return targetApp === "codex" ? "codex" : "claude";
}

function macroSlot(index: number, macro: MacroInput): SlotConfig {
  const macroIcon = typeof macro.icon === "string" ? macro.icon.trim() : "";
  const isPlaceholder =
    (macro.type === undefined || macro.type === "macro") &&
    macro.label.trim().length === 0 &&
    macro.text.trim().length === 0 &&
    macroIcon.length === 0;
  if (isPlaceholder) return emptySlot(index, macro.colors);

  if (macro.type === "approve") {
    const targetApp = resolveApprovalTargetApp(macro.targetApp);
    return {
      ...APPROVE,
      svg: macroSVG(index, macro.label, macro.icon, macro.fontSize, macro.colors, targetApp),
      title: macro.label || APPROVE.title,
      data: { targetApp },
    };
  }
  if (macro.type === "deny") {
    const targetApp = resolveApprovalTargetApp(macro.targetApp);
    return {
      ...DENY,
      svg: macroSVG(index, macro.label, macro.icon, macro.fontSize, macro.colors, targetApp),
      title: macro.label || DENY.title,
      data: { targetApp },
    };
  }
  if (macro.type === "cancel") {
    const targetApp = resolveApprovalTargetApp(macro.targetApp);
    return {
      ...CANCEL,
      svg: macroSVG(index, macro.label, macro.icon, macro.fontSize, macro.colors, targetApp),
      title: macro.label || CANCEL.title,
      data: { targetApp },
    };
  }
  if (macro.type === "restart") return { ...RESTART, svg: macroSVG(index, macro.label, macro.icon, macro.fontSize, macro.colors, "claude"), title: macro.label || RESTART.title };
  if (macro.type === "openConfig") return { ...OPEN_CONFIG, svg: macroSVG(index, macro.label, macro.icon, macro.fontSize, macro.colors, "claude"), title: macro.label || OPEN_CONFIG.title };
  if (macro.type === "approveOnceInClaude") {
    return {
      svg: macroSVG(index, macro.label, macro.icon, macro.fontSize, macro.colors, "claude"),
      title: macro.label || "Approve Once",
      action: "approveOnceInClaude",
    };
  }
  if (macro.type === "startDictationForClaude") {
    return {
      svg: macroSVG(index, macro.label, macro.icon, macro.fontSize, macro.colors, "claude"),
      title: macro.label || "Talk to Claude",
      action: "startDictationForClaude",
    };
  }
  if (macro.type === "widget" && macro.widget?.kind === "bridge-status") {
    return widgetSlot(index, macro);
  }
  const targetApp = macro.targetApp ?? "claude";
  const submit = macro.submit !== false;
  return {
    svg: macroSVG(index, macro.label, macro.icon, macro.fontSize, macro.colors, targetApp),
    title: macro.label,
    action: "macro",
    data: { text: macro.text, targetApp, submit },
  };
}

let widgetRenderContext: {
  connectionStatus?: ConnectionStatus;
  state?: string;
  timestamp?: number;
} = {};

export function setWidgetRenderContext(context: {
  connectionStatus?: ConnectionStatus;
  state?: string;
  timestamp?: number;
}): void {
  widgetRenderContext = { ...context };
}

function widgetSVG(slotIndex: number, label: string, widget: WidgetDef): string {
  const p = resolveThemePaletteForSlot(currentTheme, slotIndex);
  const bg = resolveColor(p.macroBg, defaultColors.bg, undefined);
  const fg = resolveColor(p.macroLabel, defaultColors.text, undefined);
  const conn = widgetRenderContext.connectionStatus ?? "disconnected";
  const stateRaw = widgetRenderContext.state ?? (conn === "connected" ? "idle" : "offline");
  const state = stateRaw.length > 10 ? `${stateRaw.slice(0, 9)}…` : stateRaw;
  const stamp = widgetRenderContext.timestamp ?? Date.now();
  const ageSec = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
  const ageText = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
  const mode = widget.refreshMode === "interval" ? `I:${widget.intervalMinutes ?? 1}m` : "Click";
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${bg}" />
    <text x="72" y="28" font-size="16" font-family="sans-serif" text-anchor="middle" fill="${fg}" opacity="0.9">${label || "Widget"}</text>
    <text x="72" y="64" font-size="18" font-family="sans-serif" text-anchor="middle" fill="${fg}">${conn === "connected" ? "Bridge:OK" : "Bridge:OFF"}</text>
    <text x="72" y="90" font-size="16" font-family="sans-serif" text-anchor="middle" fill="${fg}">State:${state}</text>
    <text x="72" y="116" font-size="14" font-family="sans-serif" text-anchor="middle" fill="${fg}" opacity="0.85">${mode} · ${ageText}</text>
  </svg>`;
}

function widgetSlot(index: number, macro: MacroInput): SlotConfig {
  const widget = macro.widget ?? { kind: "bridge-status" };
  return {
    svg: widgetSVG(index, macro.label, widget),
    title: macro.label,
    action: "widget-refresh",
    data: {
      widgetKind: widget.kind,
      refreshMode: widget.refreshMode ?? "onClick",
      intervalMinutes: widget.intervalMinutes ?? 1,
    },
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

function emptySlot(slotIndex = 0, colors?: ColorOverrides): SlotConfig {
  return { svg: emptySVG(slotIndex, colors), title: "" };
}

// --- Layout definitions per state ---

function buildIdleLayout(macros: MacroInput[]): LayoutDef {
  const layout: LayoutDef = {};
  for (let i = 0; i < macros.length && i < 36; i++) {
    layout[i] = macroSlot(i, macros[i]);
  }
  return layout;
}

const LAYOUTS: Record<string, LayoutDef> = {
  thinking: {
    0: THINKING,
    1: STOP,
  },

  // awaiting-approval is built dynamically by getSlotConfig (approval buttons
  // use the same Lucide + label pipeline as macros for uniform appearance).

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
  approval?: ApprovalUiMeta | null,
): SlotConfig {
  // Idle state: render from macros (config-driven or defaults)
  if (state === "idle") {
    const macroList = macros ?? DEFAULT_MACROS;
    const idleLayout = buildIdleLayout(macroList);
    return idleLayout[slotIndex] ?? emptySlot(slotIndex);
  }

  // Special case: tool-executing slot 1 shows tool name
  if (state === "tool-executing" && slotIndex === 1 && toolName) {
    return { svg: toolInfoSVG(toolName), title: toolName };
  }

  // Awaiting-approval: dynamic rendering with Lucide icons + labels
  if (state === "awaiting-approval") {
    if (slotIndex === 0) return approveSlot();
    if (slotIndex === 1) return denySlot();
    if (slotIndex === 2) return cancelSlot();
    if (slotIndex === 3) {
      const title = toolName && toolName.trim().length > 0 ? toolName : "Tool Approval";
      return { svg: approvalInfoSVG(toolName, approval), title };
    }
    return emptySlot(slotIndex);
  }

  const layout = LAYOUTS[state];
  if (!layout) return emptySlot(slotIndex);
  return layout[slotIndex] ?? emptySlot(slotIndex);
}

/** Get the full layout definition for a state. */
export function getLayout(state: string, macros?: MacroInput[]): LayoutDef {
  if (state === "idle") {
    return buildIdleLayout(macros ?? DEFAULT_MACROS);
  }
  if (state === "awaiting-approval") {
    return { 0: approveSlot(), 1: denySlot(), 2: cancelSlot() };
  }
  return LAYOUTS[state] ?? {};
}

/** List all known states that have layout definitions. */
export function getLayoutStates(): string[] {
  return ["idle", "awaiting-approval", ...Object.keys(LAYOUTS)];
}
