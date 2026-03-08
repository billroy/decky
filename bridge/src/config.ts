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
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
  | "candy-cane"
  | "gradient-blue"
  | "wormhole"
  | "rainbow"
  | "random";

export interface MacroDef {
  label: string;
  text: string;
  icon?: string;
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

export interface DeckyConfig {
  macros: MacroDef[];
  approvalTimeout: number;
  theme: Theme;
  themeSeed?: number;
  editor: string;
  colors?: ColorOverrides;
  defaultTargetApp: TargetApp;
  showTargetBadge: boolean;
  enableApproveOnce: boolean;
  enableDictation: boolean;
}

export type EditorName = "bbedit" | "code" | "cursor" | "windsurf" | "textedit";

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
  enableApproveOnce: true,
  enableDictation: true,
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
  if (typeof macro.submit === "boolean") {
    normalized.submit = macro.submit;
  }
  if (
    macro.type === "approve" ||
    macro.type === "deny" ||
    macro.type === "cancel" ||
    macro.type === "restart" ||
    macro.type === "openConfig" ||
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
  const macroIcon = typeof macro.icon === "string" ? macro.icon : "";
  if (text.length > MAX_TEXT_LENGTH) {
    throw new ConfigValidationError(`Macro text exceeds ${MAX_TEXT_LENGTH} characters`);
  }
  if (macro.icon !== undefined && typeof macro.icon !== "string") {
    throw new ConfigValidationError("Macro icon must be a string");
  }
  if (macroIcon.length > MAX_ICON_LENGTH) {
    throw new ConfigValidationError(`Macro icon exceeds ${MAX_ICON_LENGTH} characters`);
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
      macro.type !== "openConfig" &&
      macro.type !== "approveOnceInClaude" &&
      macro.type !== "startDictationForClaude"
    ) {
      throw new ConfigValidationError(
        "Macro type must be one of: macro, widget, approve, deny, cancel, restart, openConfig, approveOnceInClaude, startDictationForClaude",
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
    if (!existsSync(src)) continue;
    if (i === CONFIG_BACKUP_COUNT - 1) {
      unlinkSync(src);
      continue;
    }
    renameSync(src, backupPath(i + 1));
  }
  if (existsSync(CONFIG_PATH)) {
    copyFileSync(CONFIG_PATH, backupPath(0));
  }
}

function writeConfigAtomically(raw: string): void {
  const tmpPath = join(DECKY_DIR, `${CONFIG_TMP_PREFIX}-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(tmpPath, raw, "utf-8");
    renameSync(tmpPath, CONFIG_PATH);
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
      editor: normalizeEditor(raw_obj.editor, DEFAULT_EDITOR),
      defaultTargetApp,
      showTargetBadge:
        typeof raw_obj.showTargetBadge === "boolean"
          ? raw_obj.showTargetBadge
          : DEFAULT_CONFIG.showTargetBadge,
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
    editor:
      typeof update_obj.editor === "string"
        ? normalizeEditor(update_obj.editor, normalizeEditor(currentConfig.editor, DEFAULT_EDITOR))
        : currentConfig.editor,
    defaultTargetApp: normalizeTargetApp(update_obj.defaultTargetApp, currentConfig.defaultTargetApp),
    showTargetBadge:
      typeof update_obj.showTargetBadge === "boolean"
        ? update_obj.showTargetBadge
        : currentConfig.showTargetBadge,
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
export const DECKY_DIR_VALUE = DECKY_DIR;
