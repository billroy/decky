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
}

export interface DeckyConfig {
  macros: MacroDef[];
  approvalTimeout: number;
  theme: Theme;
  editor: string;
  colors?: ColorOverrides;
  defaultTargetApp: TargetApp;
  showTargetBadge: boolean;
}

const DECKY_DIR = join(homedir(), ".decky");
const CONFIG_PATH = join(DECKY_DIR, "config.json");

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
  editor: "bbedit",
  defaultTargetApp: "claude",
  showTargetBadge: false,
};

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
  return normalized;
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
      editor: typeof raw_obj.editor === "string" ? raw_obj.editor : DEFAULT_CONFIG.editor,
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
  const normalizedUpdateColors = normalizeColorOverrides(update.colors);
  const hasColorsField = Object.prototype.hasOwnProperty.call(update_obj, "colors");
  const merged: DeckyConfig = {
    macros: Array.isArray(update.macros)
      ? update.macros
          .map((macro) => normalizeMacro(macro, currentConfig.defaultTargetApp))
          .filter((macro): macro is MacroDef => macro !== null)
      : currentConfig.macros,
    approvalTimeout:
      typeof update.approvalTimeout === "number"
        ? update.approvalTimeout
        : currentConfig.approvalTimeout,
    theme: normalizeTheme(update_obj.theme, currentConfig.theme),
    editor: typeof update_obj.editor === "string" ? update_obj.editor : currentConfig.editor,
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
