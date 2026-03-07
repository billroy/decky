/**
 * Config module — loads and manages ~/.decky/config.json.
 *
 * The config file holds user-defined macros and other settings.
 * If the file doesn't exist, a default config is created.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface MacroDef {
  label: string;
  text: string;
  icon?: string;
}

export interface DeckyConfig {
  macros: MacroDef[];
  approvalTimeout: number;
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
  ],
  approvalTimeout: 30,
};

let currentConfig: DeckyConfig = { ...DEFAULT_CONFIG };

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

    currentConfig = {
      macros: Array.isArray(parsed.macros) ? parsed.macros : DEFAULT_CONFIG.macros,
      approvalTimeout:
        typeof parsed.approvalTimeout === "number"
          ? parsed.approvalTimeout
          : DEFAULT_CONFIG.approvalTimeout,
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

  const merged: DeckyConfig = {
    macros: Array.isArray(update.macros) ? update.macros : currentConfig.macros,
    approvalTimeout:
      typeof update.approvalTimeout === "number"
        ? update.approvalTimeout
        : currentConfig.approvalTimeout,
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
  currentConfig = merged;
  console.log(`[config] saved ${merged.macros.length} macros to ${CONFIG_PATH}`);
  return currentConfig;
}

/** Exposed for testing. */
export const CONFIG_PATH_VALUE = CONFIG_PATH;
export const DECKY_DIR_VALUE = DECKY_DIR;
