/**
 * Config module — loads and manages ~/.decky/config.json.
 *
 * The config file holds user-defined macros and other settings.
 * If the file doesn't exist, a default config is created.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { portableRenameSync } from "./fs-compat.js";
import { join } from "node:path";
import { homedir } from "node:os";

interface ColorOverrides {
  bg?: string;
  text?: string;
  icon?: string;
}

type WidgetKind = "bridge-status";
type WidgetRefreshMode = "onClick" | "interval";

interface WidgetDef {
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
  | "candy-cane"
  | "gradient-blue"
  | "wormhole"
  | "rainbow"
  | "random";

interface MacroDef {
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
    | "approveOnceInClaude"
    | "startDictationForClaude";
  widget?: WidgetDef;
}

interface DeckyConfig {
  macros: MacroDef[];
  approvalTimeout: number;
  theme: Theme;
  themeSeed?: number;
  colors?: ColorOverrides;
  defaultTargetApp: TargetApp;
  showTargetBadge: boolean;
  popUpApp: boolean;
  enableApproveOnce: boolean;
  enableDictation: boolean;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

const IS_TEST_RUNTIME =
  process.env.NODE_ENV === "test" ||
  process.env.VITEST === "true" ||
  process.argv.some((arg) => arg.includes("vitest"));
const DECKY_DIR = process.env.DECKY_HOME || (IS_TEST_RUNTIME ? join(process.cwd(), ".decky-test") : join(homedir(), ".decky"));
const CONFIG_PATH = join(DECKY_DIR, "config.json");
const CONFIG_BACKUP_COUNT = 10;
const CONFIG_TMP_PREFIX = "config.json.tmp";

const DEFAULT_CONFIG: DeckyConfig = {
  macros: [
    { label: "Proceed", text: "Proceed", icon: "thumbs-up", targetApp: "claude", colors: { icon: "#22c55e" } },
    { label: "Status", text: "Status?", icon: "circle-help", colors: { icon: "#22c55e" } },
    { label: "Stop", text: "STOP", icon: "octagon-x", targetApp: "claude", colors: { icon: "#ef4444" } },
    { label: "Push", text: "Push", icon: "zap", colors: { icon: "#f59e0b" } },
    { label: "Deploy", text: "Deploy to staging", icon: "triangle-alert", colors: { icon: "#ef4444" } },
    { label: "Proceed", text: "Proceed", icon: "thumbs-up", targetApp: "codex", colors: { icon: "#22c55e" } },
    { label: "Status", text: "Status?", icon: "circle-help", targetApp: "codex", colors: { icon: "#22c55e" } },
    { label: "Stop", text: "STOP", icon: "octagon-x", fontSize: 30, targetApp: "codex", colors: { icon: "#ef4444" } },
    { label: "Push", text: "Push", icon: "zap", targetApp: "codex", colors: { icon: "#f59e0b" } },
    { label: "Make PR", text: "Make PR", icon: "triangle-alert", targetApp: "codex", colors: { icon: "#ef4444" } },
    { label: "", text: "" },
    { label: "Talk", text: "", icon: "zap", type: "startDictationForClaude", colors: { icon: "#22c55e" } },
    { label: "README", text: "Update @README.md", icon: "pencil", colors: { icon: "#22c55e" } },
    { label: "Go", text: "Go", icon: "rocket", colors: { icon: "#22c55e" } },
    { label: "Decky Status", text: "", icon: "check", type: "widget", widget: { kind: "bridge-status", refreshMode: "onClick", intervalMinutes: 1 } },
  ],
  approvalTimeout: 30,
  theme: "dark",
  themeSeed: 0,
  defaultTargetApp: "claude",
  showTargetBadge: true,
  popUpApp: false,
  enableApproveOnce: true,
  enableDictation: false,
};

const MAX_MACROS = 36;
const MAX_LABEL_LENGTH = 20;
const MAX_TEXT_LENGTH = 2000;
const MAX_ICON_LENGTH = 64;
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 42;
const MIN_WIDGET_INTERVAL_MINUTES = 1;
const MAX_WIDGET_INTERVAL_MINUTES = 60;
const MIN_APPROVAL_TIMEOUT = 5;
const MAX_APPROVAL_TIMEOUT = 300;
const ICON_ALIASES: Readonly<Record<string, string>> = {
  checkmark: "check",
  stop: "octagon-x",
  exclamation: "triangle-alert",
  "circle-stop": "octagon-x",
};

let currentConfig: DeckyConfig = { ...DEFAULT_CONFIG };

export interface ConfigBackupInfo {
  index: number;
  path: string;
  modifiedAt: number;
  size: number;
}

function normalizeTheme(value: unknown, fallback: Theme): Theme {
  return value === "light" ||
    value === "dark" ||
    value === "dracula" ||
    value === "monokai" ||
    value === "solarized-dark" ||
    value === "solarized-light" ||
    value === "nord" ||
    value === "github-dark" ||
    value === "candy-cane" ||
    value === "gradient-blue" ||
    value === "wormhole" ||
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

function normalizeIcon(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return ICON_ALIASES[trimmed] ?? trimmed;
}

function normalizeFontSize(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const size = Math.floor(value);
  if (size < MIN_FONT_SIZE || size > MAX_FONT_SIZE) return undefined;
  return size;
}

function normalizeMacro(value: unknown, fallbackTarget: TargetApp): MacroDef | null {
  if (!value || typeof value !== "object") return null;
  const macro = value as Record<string, unknown>;
  if (typeof macro.label !== "string" || typeof macro.text !== "string") return null;

  const normalized: MacroDef = { label: macro.label, text: macro.text };
  const icon = normalizeIcon(macro.icon);
  if (icon) normalized.icon = icon;
  const fontSize = normalizeFontSize(macro.fontSize);
  if (fontSize !== undefined) normalized.fontSize = fontSize;
  const normalizedColors = normalizeColorOverrides(macro.colors);
  if (normalizedColors) normalized.colors = normalizedColors;
  if (macro.targetApp !== undefined) {
    normalized.targetApp = normalizeTargetApp(macro.targetApp, fallbackTarget);
  }
  if (typeof macro.submit === "boolean") {
    normalized.submit = macro.submit;
  }
  if (
    macro.type === "approve" ||
    macro.type === "deny" ||
    macro.type === "cancel" ||
    macro.type === "restart" ||
    macro.type === "approveOnceInClaude" ||
    macro.type === "startDictationForClaude"
  ) {
    normalized.type = macro.type;
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
  const macroIcon = normalizeIcon(macro.icon) ?? "";
  if (text.length > MAX_TEXT_LENGTH) {
    throw new ConfigValidationError(`Macro text exceeds ${MAX_TEXT_LENGTH} characters`);
  }
  if (macro.icon !== undefined && typeof macro.icon !== "string") {
    throw new ConfigValidationError("Macro icon must be a string");
  }
  if (macroIcon.length > MAX_ICON_LENGTH) {
    throw new ConfigValidationError(`Macro icon exceeds ${MAX_ICON_LENGTH} characters`);
  }
  if (macro.fontSize !== undefined) {
    if (typeof macro.fontSize !== "number" || !Number.isFinite(macro.fontSize)) {
      throw new ConfigValidationError("Macro fontSize must be a number");
    }
    const n = Math.floor(macro.fontSize);
    if (n < MIN_FONT_SIZE || n > MAX_FONT_SIZE) {
      throw new ConfigValidationError(`Macro fontSize must be between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}`);
    }
  }

  const isPlaceholder =
    (macro.type === undefined || macro.type === "macro") &&
    label.length === 0 &&
    text.trim().length === 0 &&
    macroIcon.length === 0;

  // Empty label+text is a reserved sparse-slot placeholder used to preserve
  // physical slot index mapping for unconfigured Decky keys.
  // Placeholders may carry color overrides and stale metadata from older builds.
  // Canonicalize to label/text/colors only so per-slot color edits remain robust.
  if (isPlaceholder) {
    const out: MacroDef = { label: "", text: "" };
    const placeholderColors = normalizeColorOverrides(macro.colors);
    if (placeholderColors) out.colors = placeholderColors;
    return out;
  }

  if (label.length > MAX_LABEL_LENGTH) {
    throw new ConfigValidationError(`Macro label exceeds ${MAX_LABEL_LENGTH} characters`);
  }
  const out: MacroDef = { label, text };
  if (macroIcon.length > 0) out.icon = macroIcon;
  if (macro.fontSize !== undefined) out.fontSize = Math.floor(macro.fontSize);
  if (macro.targetApp !== undefined) out.targetApp = normalizeTargetApp(macro.targetApp, fallbackTarget);
  if (macro.submit !== undefined) {
    if (typeof macro.submit !== "boolean") throw new ConfigValidationError("Macro submit must be a boolean");
    out.submit = macro.submit;
  }
  if (macro.type !== undefined) {
    if (
      macro.type !== "macro" &&
      macro.type !== "widget" &&
      macro.type !== "approve" &&
      macro.type !== "deny" &&
      macro.type !== "cancel" &&
      macro.type !== "restart" &&
      macro.type !== "approveOnceInClaude" &&
      macro.type !== "startDictationForClaude"
    ) {
      throw new ConfigValidationError(
        "Macro type must be one of: macro, widget, approve, deny, cancel, restart, approveOnceInClaude, startDictationForClaude",
      );
    }
    if (macro.type !== "macro") out.type = macro.type;
    if (macro.type === "widget") {
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

function backupPath(index: number): string {
  return join(DECKY_DIR, `config.json.bak.${index}`);
}

function rotateBackups(): void {
  for (let i = CONFIG_BACKUP_COUNT - 1; i >= 0; i--) {
    const src = backupPath(i);
    try {
      if (i === CONFIG_BACKUP_COUNT - 1) {
        unlinkSync(src);
      } else {
        portableRenameSync(src, backupPath(i + 1));
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // File already gone — safe to skip.
    }
  }
  if (existsSync(CONFIG_PATH)) {
    copyFileSync(CONFIG_PATH, backupPath(0));
  }
}

function writeConfigAtomically(raw: string): void {
  const tmpPath = join(DECKY_DIR, `${CONFIG_TMP_PREFIX}-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(tmpPath, raw, "utf-8");
    portableRenameSync(tmpPath, CONFIG_PATH);
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}

export function listConfigBackups(): ConfigBackupInfo[] {
  ensureDir();
  const out: ConfigBackupInfo[] = [];
  for (let i = 0; i < CONFIG_BACKUP_COUNT; i++) {
    const path = backupPath(i);
    if (!existsSync(path)) continue;
    const st = statSync(path);
    out.push({
      index: i,
      path,
      modifiedAt: st.mtimeMs,
      size: st.size,
    });
  }
  return out;
}

export function restoreConfigBackup(index: number): DeckyConfig {
  ensureDir();
  if (!Number.isInteger(index) || index < 0 || index >= CONFIG_BACKUP_COUNT) {
    throw new ConfigValidationError(`backup index must be between 0 and ${CONFIG_BACKUP_COUNT - 1}`);
  }
  const src = backupPath(index);
  if (!existsSync(src)) {
    throw new ConfigValidationError(`backup index ${index} does not exist`);
  }
  const raw = readFileSync(src, "utf-8");
  // Ensure backup is at least parseable before replacing live config.
  try {
    JSON.parse(raw);
  } catch {
    throw new ConfigValidationError(`backup index ${index} is not valid JSON`);
  }
  rotateBackups();
  writeConfigAtomically(raw);
  return loadConfig();
}

/** Ensure ~/.decky/ directory exists. */
function ensureDir(): void {
  mkdirSync(DECKY_DIR, { recursive: true });
}

/** Load config from disk, creating default if missing. */
export function loadConfig(): DeckyConfig {
  ensureDir();

  if (!existsSync(CONFIG_PATH)) {
    writeConfigAtomically(JSON.stringify(DEFAULT_CONFIG, null, 2));
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
      defaultTargetApp,
      showTargetBadge:
        typeof raw_obj.showTargetBadge === "boolean"
          ? raw_obj.showTargetBadge
          : DEFAULT_CONFIG.showTargetBadge,
      popUpApp:
        typeof raw_obj.popUpApp === "boolean"
          ? raw_obj.popUpApp
          : DEFAULT_CONFIG.popUpApp,
      enableApproveOnce:
        typeof raw_obj.enableApproveOnce === "boolean"
          ? raw_obj.enableApproveOnce
          : DEFAULT_CONFIG.enableApproveOnce,
      enableDictation:
        typeof raw_obj.enableDictation === "boolean"
          ? raw_obj.enableDictation
          : DEFAULT_CONFIG.enableDictation,
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
  if (update_obj.popUpApp !== undefined && typeof update_obj.popUpApp !== "boolean") {
    throw new ConfigValidationError("popUpApp must be a boolean");
  }
  if (update_obj.enableApproveOnce !== undefined && typeof update_obj.enableApproveOnce !== "boolean") {
    throw new ConfigValidationError("enableApproveOnce must be a boolean");
  }
  if (update_obj.enableDictation !== undefined && typeof update_obj.enableDictation !== "boolean") {
    throw new ConfigValidationError("enableDictation must be a boolean");
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
              // and preserve slot index alignment for sparse/unconfigured slots.
              return currentConfig.macros[i] ?? { label: "", text: "" };
            }
          })
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
    defaultTargetApp: normalizeTargetApp(update_obj.defaultTargetApp, currentConfig.defaultTargetApp),
    showTargetBadge:
      typeof update_obj.showTargetBadge === "boolean"
        ? update_obj.showTargetBadge
        : currentConfig.showTargetBadge,
    popUpApp:
      typeof update_obj.popUpApp === "boolean"
        ? update_obj.popUpApp
        : currentConfig.popUpApp,
    enableApproveOnce:
      typeof update_obj.enableApproveOnce === "boolean"
        ? update_obj.enableApproveOnce
        : currentConfig.enableApproveOnce,
    enableDictation:
      typeof update_obj.enableDictation === "boolean"
        ? update_obj.enableDictation
        : currentConfig.enableDictation,
    ...(hasColorsField
      ? (normalizedUpdateColors ? { colors: normalizedUpdateColors } : {})
      : (currentConfig.colors ? { colors: currentConfig.colors } : {})),
  };

  rotateBackups();
  writeConfigAtomically(JSON.stringify(merged, null, 2));
  currentConfig = merged;
  console.log(`[config] saved ${merged.macros.length} macros to ${CONFIG_PATH}`);
  return currentConfig;
}

/** Exposed for testing. */
export const CONFIG_PATH_VALUE = CONFIG_PATH;
