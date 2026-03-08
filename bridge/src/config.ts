/**
 * Config module — loads and manages ~/.decky/config.json.
 *
 * The config file holds user-defined macros and other settings.
 * If the file doesn't exist, a default config is created.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ColorOverrides {
  bg?: string;
  text?: string;
  icon?: string;
}

export type WidgetKind = "bridge-status";
export type WidgetRefreshMode = "onClick" | "interval";

export interface WidgetDef {
  kind: WidgetKind;
  refreshMode?: WidgetRefreshMode;
  intervalMinutes?: number;
}

export type TargetApp = "claude" | "codex" | "chatgpt" | "cursor" | "windsurf";
export type Theme =
  | "light"
  | "dark"
  | "dracula"
  | "monokai"
  | "solarized-dark"
  | "solarized-light"
  | "nord"
  | "github-dark"
  | "rainbow"
  | "random";

export interface MacroDef {
  label: string;
  text: string;
  icon?: string;
  colors?: ColorOverrides;
  targetApp?: TargetApp;
  type?: "macro" | "widget";
  widget?: WidgetDef;
}

export interface DeckyConfig {
  macros: MacroDef[];
  approvalTimeout: number;
  theme: Theme;
  themeSeed?: number;
  editor: string;
  colors?: ColorOverrides;
  defaultTargetApp: TargetApp;
  showTargetBadge: boolean;
}

export type EditorName = "bbedit" | "code" | "cursor" | "windsurf" | "textedit";

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

const DECKY_DIR = process.env.DECKY_HOME || join(homedir(), ".decky");
const CONFIG_PATH = join(DECKY_DIR, "config.json");

const DEFAULT_EDITOR: EditorName = "bbedit";

const DEFAULT_CONFIG: DeckyConfig = {
  macros: [
    { label: "Continue", text: "Continue", icon: "checkmark" },
    { label: "Yes", text: "Yes", icon: "checkmark" },
    { label: "No", text: "No", icon: "stop" },
    { label: "Stop", text: "Stop what you are doing.", icon: "stop" },
    { label: "Summarize", text: "Summarize what you've done so far." },
    { label: "Make it so", text: "Make it so", icon: "checkmark" },
    { label: "Commit", text: "Commit", icon: "exclamation" },
    { label: "Deploy", text: "Deploy and monitor", icon: "exclamation" },
    { label: "Usage", text: "Show usage", icon: "checkmark" },
    { label: "Session?", text: "Is it time to move to a new session?", icon: "checkmark" },
  ],
  approvalTimeout: 30,
  theme: "light",
  themeSeed: 0,
  editor: DEFAULT_EDITOR,
  defaultTargetApp: "claude",
  showTargetBadge: false,
};

export const MAX_MACROS = 36;
export const MAX_LABEL_LENGTH = 20;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_ICON_LENGTH = 64;
export const MIN_WIDGET_INTERVAL_MINUTES = 1;
export const MAX_WIDGET_INTERVAL_MINUTES = 60;
export const MAX_EDITOR_LENGTH = 128;
export const MIN_APPROVAL_TIMEOUT = 5;
export const MAX_APPROVAL_TIMEOUT = 300;
const ALLOWED_EDITORS: readonly EditorName[] = ["bbedit", "code", "cursor", "windsurf", "textedit"];

let currentConfig: DeckyConfig = { ...DEFAULT_CONFIG };

function normalizeTheme(value: unknown, fallback: Theme): Theme {
  return value === "light" ||
    value === "dark" ||
    value === "dracula" ||
    value === "monokai" ||
    value === "solarized-dark" ||
    value === "solarized-light" ||
    value === "nord" ||
    value === "github-dark" ||
    value === "rainbow" ||
    value === "random"
    ? value
    : fallback;
}

function normalizeTargetApp(value: unknown, fallback: TargetApp): TargetApp {
  return value === "claude" ||
    value === "codex" ||
    value === "chatgpt" ||
    value === "cursor" ||
    value === "windsurf"
    ? value
    : fallback;
}

function normalizeEditor(value: unknown, fallback: EditorName): EditorName {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  return (ALLOWED_EDITORS as readonly string[]).includes(v) ? (v as EditorName) : fallback;
}

function normalizeMacro(value: unknown, fallbackTarget: TargetApp): MacroDef | null {
  if (!value || typeof value !== "object") return null;
  const macro = value as Record<string, unknown>;
  if (typeof macro.label !== "string" || typeof macro.text !== "string") return null;

  const normalized: MacroDef = { label: macro.label, text: macro.text };
  if (typeof macro.icon === "string") normalized.icon = macro.icon;
  const normalizedColors = normalizeColorOverrides(macro.colors);
  if (normalizedColors) normalized.colors = normalizedColors;
  if (macro.targetApp !== undefined) {
    normalized.targetApp = normalizeTargetApp(macro.targetApp, fallbackTarget);
  }
  if (macro.type === "widget") {
    normalized.type = "widget";
    const widget = normalizeWidget(macro.widget);
    if (widget) normalized.widget = widget;
  }
  return normalized;
}

function normalizeWidget(value: unknown): WidgetDef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const kind = obj.kind === "bridge-status" ? "bridge-status" : undefined;
  if (!kind) return undefined;
  const out: WidgetDef = { kind };
  if (obj.refreshMode === "onClick" || obj.refreshMode === "interval") {
    out.refreshMode = obj.refreshMode;
  }
  if (typeof obj.intervalMinutes === "number" && Number.isFinite(obj.intervalMinutes)) {
    const n = Math.floor(obj.intervalMinutes);
    if (n >= MIN_WIDGET_INTERVAL_MINUTES && n <= MAX_WIDGET_INTERVAL_MINUTES) {
      out.intervalMinutes = n;
    }
  }
  return out;
}

function parseMacroStrict(value: unknown, fallbackTarget: TargetApp): MacroDef {
  if (!value || typeof value !== "object") throw new ConfigValidationError("Macro must be an object");
  const macro = value as Record<string, unknown>;
  if (typeof macro.label !== "string") throw new ConfigValidationError("Macro label must be a string");
  if (typeof macro.text !== "string") throw new ConfigValidationError("Macro text must be a string");
  const label = macro.label.trim();
  const text = macro.text;
  if (label.length === 0) throw new ConfigValidationError("Macro label must not be empty");
  if (label.length > MAX_LABEL_LENGTH) {
    throw new ConfigValidationError(`Macro label exceeds ${MAX_LABEL_LENGTH} characters`);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new ConfigValidationError(`Macro text exceeds ${MAX_TEXT_LENGTH} characters`);
  }
  const out: MacroDef = { label, text };
  if (macro.icon !== undefined) {
    if (typeof macro.icon !== "string") throw new ConfigValidationError("Macro icon must be a string");
    if (macro.icon.length > MAX_ICON_LENGTH) {
      throw new ConfigValidationError(`Macro icon exceeds ${MAX_ICON_LENGTH} characters`);
    }
    if (macro.icon.length > 0) out.icon = macro.icon;
  }
  if (macro.targetApp !== undefined) out.targetApp = normalizeTargetApp(macro.targetApp, fallbackTarget);
  if (macro.type !== undefined) {
    if (macro.type !== "macro" && macro.type !== "widget") {
      throw new ConfigValidationError("Macro type must be 'macro' or 'widget'");
    }
    if (macro.type === "widget") {
      out.type = "widget";
      const widget = normalizeWidget(macro.widget);
      if (!widget) throw new ConfigValidationError("Widget macro must include a valid widget definition");
      out.widget = widget;
    }
  }
  if (macro.colors !== undefined) {
    const colors = normalizeColorOverrides(macro.colors);
    if (!colors) throw new ConfigValidationError("Macro colors must contain valid hex color values");
    out.colors = colors;
  }
  return out;
}

function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : undefined;
}

function normalizeColorOverrides(value: unknown): ColorOverrides | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const bg = normalizeHex(obj.bg);
  const text = normalizeHex(obj.text);
  const icon = normalizeHex(obj.icon);
  if (!bg && !text && !icon) return undefined;
  const out: ColorOverrides = {};
  if (bg) out.bg = bg;
  if (text) out.text = text;
  if (icon) out.icon = icon;
  return out;
}

/** Ensure ~/.decky/ directory exists. */
function ensureDir(): void {
  mkdirSync(DECKY_DIR, { recursive: true });
}

/** Load config from disk, creating default if missing. */
export function loadConfig(): DeckyConfig {
  ensureDir();

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
    console.log(`[config] created default config at ${CONFIG_PATH}`);
    currentConfig = { ...DEFAULT_CONFIG };
    return currentConfig;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DeckyConfig>;

    const raw_obj = parsed as Record<string, unknown>;
    const colors = normalizeColorOverrides(raw_obj.colors);
    const defaultTargetApp = normalizeTargetApp(raw_obj.defaultTargetApp, DEFAULT_CONFIG.defaultTargetApp);
    const parsedMacros = Array.isArray(parsed.macros)
      ? parsed.macros
          .map((macro) => normalizeMacro(macro, defaultTargetApp))
          .filter((macro): macro is MacroDef => macro !== null)
      : DEFAULT_CONFIG.macros;
    currentConfig = {
      macros: Array.isArray(parsed.macros) ? parsedMacros : DEFAULT_CONFIG.macros,
      approvalTimeout:
        typeof parsed.approvalTimeout === "number"
          ? parsed.approvalTimeout
          : DEFAULT_CONFIG.approvalTimeout,
      theme: normalizeTheme(raw_obj.theme, DEFAULT_CONFIG.theme),
      themeSeed:
        typeof raw_obj.themeSeed === "number" && Number.isFinite(raw_obj.themeSeed)
          ? Math.floor(raw_obj.themeSeed)
          : DEFAULT_CONFIG.themeSeed,
      editor: normalizeEditor(raw_obj.editor, DEFAULT_EDITOR),
      defaultTargetApp,
      showTargetBadge:
        typeof raw_obj.showTargetBadge === "boolean"
          ? raw_obj.showTargetBadge
          : DEFAULT_CONFIG.showTargetBadge,
      ...(colors ? { colors } : {}),
    };

    console.log(`[config] loaded ${currentConfig.macros.length} macros from ${CONFIG_PATH}`);
    return currentConfig;
  } catch (err) {
    console.error(`[config] failed to parse config, using defaults:`, err);
    currentConfig = { ...DEFAULT_CONFIG };
    return currentConfig;
  }
}

/** Get the current in-memory config. */
export function getConfig(): DeckyConfig {
  return currentConfig;
}

/** Reload config from disk. Returns the new config. */
export function reloadConfig(): DeckyConfig {
  return loadConfig();
}

/** Save config to disk and update in-memory copy. Returns the saved config. */
export function saveConfig(update: Partial<DeckyConfig>): DeckyConfig {
  ensureDir();

  const update_obj = update as Record<string, unknown>;
  if (update.macros !== undefined) {
    if (!Array.isArray(update.macros)) throw new ConfigValidationError("macros must be an array");
    if (update.macros.length > MAX_MACROS) {
      throw new ConfigValidationError(`macros must not exceed ${MAX_MACROS} entries`);
    }
  }
  if (update.approvalTimeout !== undefined) {
    if (!Number.isInteger(update.approvalTimeout)) {
      throw new ConfigValidationError("approvalTimeout must be an integer");
    }
    if (update.approvalTimeout < MIN_APPROVAL_TIMEOUT || update.approvalTimeout > MAX_APPROVAL_TIMEOUT) {
      throw new ConfigValidationError(
        `approvalTimeout must be between ${MIN_APPROVAL_TIMEOUT} and ${MAX_APPROVAL_TIMEOUT}`
      );
    }
  }
  if (update_obj.editor !== undefined) {
    if (typeof update_obj.editor !== "string") throw new ConfigValidationError("editor must be a string");
    if (update_obj.editor.length > MAX_EDITOR_LENGTH) {
      throw new ConfigValidationError(`editor must not exceed ${MAX_EDITOR_LENGTH} characters`);
    }
    if (!ALLOWED_EDITORS.includes(update_obj.editor.trim().toLowerCase() as EditorName)) {
      throw new ConfigValidationError(`editor must be one of: ${ALLOWED_EDITORS.join(", ")}`);
    }
  }
  if (update_obj.themeSeed !== undefined) {
    if (typeof update_obj.themeSeed !== "number" || !Number.isFinite(update_obj.themeSeed)) {
      throw new ConfigValidationError("themeSeed must be a finite number");
    }
    if (Math.floor(update_obj.themeSeed) < 0 || Math.floor(update_obj.themeSeed) > 0x7fffffff) {
      throw new ConfigValidationError("themeSeed must be between 0 and 2147483647");
    }
  }
  if (update_obj.showTargetBadge !== undefined && typeof update_obj.showTargetBadge !== "boolean") {
    throw new ConfigValidationError("showTargetBadge must be a boolean");
  }
  if (update_obj.defaultTargetApp !== undefined) {
    const v = update_obj.defaultTargetApp;
    if (v !== "claude" && v !== "codex" && v !== "chatgpt" && v !== "cursor" && v !== "windsurf") {
      throw new ConfigValidationError("defaultTargetApp is invalid");
    }
  }
  const normalizedUpdateColors = normalizeColorOverrides(update.colors);
  const hasColorsField = Object.prototype.hasOwnProperty.call(update_obj, "colors");
  if (hasColorsField && update.colors !== undefined) {
    // Allow empty object/empty strings to explicitly clear page defaults.
    if (update.colors === null || typeof update.colors !== "object") {
      throw new ConfigValidationError("colors must be an object");
    }
  }
  const parsedMacros =
    Array.isArray(update.macros)
      ? update.macros
          .map((macro, i) => {
            try {
              return parseMacroStrict(macro, currentConfig.defaultTargetApp);
            } catch {
              // Keep existing macro at this index when a single edited row is invalid,
              // so other valid updates (for example targetApp changes) still persist.
              return currentConfig.macros[i] ?? null;
            }
          })
          .filter((macro): macro is MacroDef => macro !== null)
      : undefined;
  const merged: DeckyConfig = {
    macros: parsedMacros ?? currentConfig.macros,
    approvalTimeout:
      typeof update.approvalTimeout === "number"
        ? update.approvalTimeout
        : currentConfig.approvalTimeout,
    theme: normalizeTheme(update_obj.theme, currentConfig.theme),
    themeSeed:
      typeof update_obj.themeSeed === "number" && Number.isFinite(update_obj.themeSeed)
        ? Math.floor(update_obj.themeSeed)
        : currentConfig.themeSeed,
    editor:
      typeof update_obj.editor === "string"
        ? normalizeEditor(update_obj.editor, normalizeEditor(currentConfig.editor, DEFAULT_EDITOR))
        : currentConfig.editor,
    defaultTargetApp: normalizeTargetApp(update_obj.defaultTargetApp, currentConfig.defaultTargetApp),
    showTargetBadge:
      typeof update_obj.showTargetBadge === "boolean"
        ? update_obj.showTargetBadge
        : currentConfig.showTargetBadge,
    ...(hasColorsField
      ? (normalizedUpdateColors ? { colors: normalizedUpdateColors } : {})
      : (currentConfig.colors ? { colors: currentConfig.colors } : {})),
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
  currentConfig = merged;
  console.log(`[config] saved ${merged.macros.length} macros to ${CONFIG_PATH}`);
  return currentConfig;
}

/** Exposed for testing. */
export const CONFIG_PATH_VALUE = CONFIG_PATH;
export const DECKY_DIR_VALUE = DECKY_DIR;
