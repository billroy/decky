export interface TestMacro {
  label: string;
  text: string;
  icon?: string;
  targetApp?: string;
  submit?: boolean;
  type?: "macro" | "widget";
  widget?: {
    kind?: "bridge-status";
    refreshMode?: "onClick" | "interval";
    intervalMinutes?: number;
  } | null;
  colors?: { bg?: string; text?: string; icon?: string };
}

export interface ConfigSnapshot {
  type: "configSnapshot";
  piProtocolVersion: number;
  macros: TestMacro[];
  theme: string;
  themeSeed: number;
  approvalTimeout: number;
  defaultTargetApp: string;
  showTargetBadge: boolean;
  enableApproveOnce?: boolean;
  enableDictation?: boolean;
  selectedMacroIndex: number;
  colors?: { bg?: string; text?: string; icon?: string };
}

export const DEFAULT_TEST_CONFIG: ConfigSnapshot = {
  type: "configSnapshot",
  piProtocolVersion: 2,
  macros: [
    { label: "Yes", text: "/yes", icon: "checkmark", targetApp: "claude" },
    { label: "No", text: "/no", icon: "x", targetApp: "" },
    {
      label: "Build",
      text: "npm run build",
      icon: "terminal",
      targetApp: "codex",
      colors: { bg: "#1e3a5f", text: "#ffffff", icon: "" },
    },
  ],
  theme: "dark",
  themeSeed: 0,
  approvalTimeout: 30,
  defaultTargetApp: "claude",
  showTargetBadge: true,
  enableApproveOnce: true,
  enableDictation: true,
  selectedMacroIndex: 0,
  colors: { bg: "", text: "", icon: "" },
};

export function cloneConfig(cfg: ConfigSnapshot = DEFAULT_TEST_CONFIG): ConfigSnapshot {
  return JSON.parse(JSON.stringify(cfg)) as ConfigSnapshot;
}

export function applyUpdateToConfig(
  current: ConfigSnapshot,
  update: Record<string, unknown>,
): ConfigSnapshot {
  const next = cloneConfig(current);
  if (Array.isArray(update.macros)) next.macros = update.macros as TestMacro[];
  if (typeof update.theme === "string") next.theme = update.theme;
  if (typeof update.themeSeed === "number") next.themeSeed = Math.floor(update.themeSeed);
  if (typeof update.approvalTimeout === "number") next.approvalTimeout = update.approvalTimeout;
  if (typeof update.defaultTargetApp === "string") next.defaultTargetApp = update.defaultTargetApp;
  if (typeof update.showTargetBadge === "boolean") next.showTargetBadge = update.showTargetBadge;
  if (typeof update.enableApproveOnce === "boolean") next.enableApproveOnce = update.enableApproveOnce;
  if (typeof update.enableDictation === "boolean") next.enableDictation = update.enableDictation;
  if (Object.prototype.hasOwnProperty.call(update, "colors")) {
    const colors = update.colors as { bg?: string; text?: string; icon?: string } | undefined;
    if (colors && (colors.bg || colors.text || colors.icon)) {
      next.colors = {
        bg: colors.bg || "",
        text: colors.text || "",
        icon: colors.icon || "",
      };
    } else {
      delete next.colors;
    }
  }
  if (typeof next.selectedMacroIndex !== "number") next.selectedMacroIndex = 0;
  return next;
}
