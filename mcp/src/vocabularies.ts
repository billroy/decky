/**
 * Named vocabularies for MCP tools.
 * These tables are returned by list_* tools and used to resolve natural-language names.
 */

export const NAMED_COLORS: Record<string, string> = {
  red: "#ef4444",
  green: "#22c55e",
  blue: "#3b82f6",
  yellow: "#eab308",
  orange: "#f97316",
  purple: "#a855f7",
  pink: "#ec4899",
  white: "#ffffff",
  black: "#000000",
  gray: "#6b7280",
  grey: "#6b7280",
  amber: "#f59e0b",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  lime: "#84cc16",
  indigo: "#6366f1",
  rose: "#f43f5e",
};

/**
 * Named icon aliases → canonical Lucide icon names.
 * These must match the LUCIDE_ICONS keys in plugin/src/layouts.ts.
 */
export const NAMED_ICONS: Record<string, string> = {
  // Direct Lucide icon names (canonical)
  check: "check",
  x: "x",
  "octagon-x": "octagon-x",
  ban: "ban",
  "shield-off": "shield-off",
  hand: "hand",
  "clock-3": "clock-3",
  "timer-reset": "timer-reset",
  "message-square-warning": "message-square-warning",
  "file-warning": "file-warning",
  slash: "slash",
  "bell-off": "bell-off",
  "triangle-alert": "triangle-alert",
  zap: "zap",
  settings: "settings",
  pencil: "pencil",
  star: "star",
  "refresh-cw": "refresh-cw",
  "corner-down-left": "corner-down-left",
  lock: "lock",
  folder: "folder",
  play: "play",
  pause: "pause",
  send: "send",
  terminal: "terminal",
  code: "code",
  "git-branch": "git-branch",
  bug: "bug",
  rocket: "rocket",
  "thumbs-up": "thumbs-up",
  "thumbs-down": "thumbs-down",
  "circle-help": "circle-help",
  infinity: "infinity",
  // Friendly aliases → canonical names
  checkmark: "check",
  cross: "x",
  stop: "octagon-x",
  warning: "triangle-alert",
  alert: "triangle-alert",
  gear: "settings",
  edit: "pencil",
  refresh: "refresh-cw",
  branch: "git-branch",
  git: "git-branch",
  help: "circle-help",
  question: "circle-help",
  clock: "clock-3",
  timer: "timer-reset",
  like: "thumbs-up",
  dislike: "thumbs-down",
};

export const THEMES = [
  { name: "light", description: "Light gray background, dark text" },
  { name: "dark", description: "Dark background, light text" },
  { name: "dracula", description: "Purple/pink dark theme" },
  { name: "monokai", description: "Green/orange on dark" },
  { name: "solarized-dark", description: "Solarized dark palette" },
  { name: "solarized-light", description: "Solarized light palette" },
  { name: "nord", description: "Cool blue-gray Nordic palette" },
  { name: "github-dark", description: "GitHub dark mode colors" },
  { name: "candy-cane", description: "Red/white festive theme" },
  { name: "gradient-blue", description: "Blue gradient backgrounds" },
  { name: "wormhole", description: "Dark with electric accents" },
  { name: "rainbow", description: "Deterministic per-slot hue rotation" },
  { name: "random", description: "Random color per slot on each render" },
];

export const SLOT_TYPES = [
  {
    type: "macro",
    description: "Text injection with optional auto-submit",
    configurableFields: ["label", "text", "icon", "fontSize", "colors", "targetApp", "submit"],
  },
  {
    type: "approve",
    description: "Approve the queued tool",
    configurableFields: ["label", "colors"],
  },
  {
    type: "deny",
    description: "Deny the queued tool",
    configurableFields: ["label", "colors"],
  },
  {
    type: "cancel",
    description: "Cancel or stop execution",
    configurableFields: ["label", "colors"],
  },
  {
    type: "restart",
    description: "Force return to idle state",
    configurableFields: ["label", "colors"],
  },
  {
    type: "approveOnceInClaude",
    description: "Approve and activate Claude.app",
    configurableFields: ["label", "colors"],
  },
  {
    type: "startDictationForClaude",
    description: "Start macOS dictation (macOS only)",
    configurableFields: ["label", "colors"],
  },
  {
    type: "widget",
    description: "Status display widget",
    configurableFields: [
      "label",
      "colors",
      "widget.kind",
    ],
  },
];

export const WIDGET_KINDS = [
  { kind: "bridge-status", description: "Shows bridge connection status (green/red dot)" },
];

export const TARGET_APPS = [
  { name: "claude", description: "Claude.app" },
  { name: "codex", description: "Codex CLI" },
  { name: "chatgpt", description: "ChatGPT desktop" },
  { name: "cursor", description: "Cursor editor" },
  { name: "windsurf", description: "Windsurf editor" },
];

const VALID_THEMES = new Set(THEMES.map((t) => t.name));
const VALID_SLOT_TYPES = new Set(SLOT_TYPES.map((s) => s.type));
const VALID_TARGET_APPS = new Set(TARGET_APPS.map((a) => a.name));

/** Resolve a color name or pass through a CSS color string. */
export function resolveColor(value: string): string {
  const lower = value.toLowerCase().trim();
  return NAMED_COLORS[lower] ?? value;
}

/** Resolve an icon name or pass through the raw string. */
export function resolveIcon(value: string): string {
  const lower = value.toLowerCase().trim();
  return NAMED_ICONS[lower] ?? value;
}

/** Return undefined if the theme name is valid, or an error string. */
export function validateTheme(name: string): string | undefined {
  if (!VALID_THEMES.has(name)) {
    return `Unknown theme "${name}". Valid themes: ${[...VALID_THEMES].join(", ")}`;
  }
}

/** Return undefined if the slot type is valid, or an error string. */
export function validateSlotType(type: string): string | undefined {
  if (!VALID_SLOT_TYPES.has(type)) {
    return `Unknown slot type "${type}". Valid types: ${[...VALID_SLOT_TYPES].join(", ")}`;
  }
}

/** Return undefined if the target app is valid, or an error string. */
export function validateTargetApp(app: string): string | undefined {
  if (!VALID_TARGET_APPS.has(app)) {
    return `Unknown target app "${app}". Valid apps: ${[...VALID_TARGET_APPS].join(", ")}`;
  }
}

/** Types that support the icon and text fields. */
export function slotSupportsIcon(type: string): boolean {
  return type === "macro" || !type; // undefined/null type defaults to macro
}
