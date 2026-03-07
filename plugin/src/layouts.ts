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

// --- SVG generators ---

function roundedRect(color: string, symbol: string, fontSize = 64): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="${color}" />
    <text x="72" y="${fontSize > 40 ? 88 : 82}" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="white">${symbol}</text>
  </svg>`;
}

function macroSVG(n: number): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="#1e3a5f" />
    <text x="72" y="92" font-size="72" font-family="sans-serif" text-anchor="middle" fill="#94a3b8">${n}</text>
  </svg>`;
}

function toolInfoSVG(toolName: string): string {
  const displayName = toolName.length > 8 ? toolName.slice(0, 7) + "\u2026" : toolName;
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="#1e293b" />
    <text x="72" y="60" font-size="20" font-family="sans-serif" text-anchor="middle" fill="#94a3b8">Tool</text>
    <text x="72" y="100" font-size="32" font-family="sans-serif" text-anchor="middle" fill="#e2e8f0">${displayName}</text>
  </svg>`;
}

function thinkingSVG(): string {
  return `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
    <rect width="144" height="144" rx="16" fill="#1e293b" />
    <circle cx="50" cy="72" r="10" fill="#3b82f6" opacity="0.9" />
    <circle cx="72" cy="72" r="10" fill="#3b82f6" opacity="0.6" />
    <circle cx="94" cy="72" r="10" fill="#3b82f6" opacity="0.3" />
  </svg>`;
}

const EMPTY_SVG = `<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
  <rect width="144" height="144" rx="16" fill="#0f172a" opacity="0.5" />
</svg>`;

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

function macroSlot(n: number): SlotConfig {
  return {
    svg: macroSVG(n),
    title: `Macro ${n}`,
    action: "macro",
    data: { index: n },
  };
}

const EMPTY: SlotConfig = {
  svg: EMPTY_SVG,
  title: "",
};

// --- Layout definitions per state ---

const LAYOUTS: Record<string, LayoutDef> = {
  idle: {
    0: macroSlot(1),
    1: macroSlot(2),
    2: macroSlot(3),
    3: macroSlot(4),
    4: macroSlot(5),
    5: macroSlot(6),
  },

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
): SlotConfig {
  // Special case: tool-executing slot 1 shows tool name
  if (state === "tool-executing" && slotIndex === 1 && toolName) {
    return { svg: toolInfoSVG(toolName), title: toolName };
  }

  // Special case: awaiting-approval slot 3 shows tool name
  if (state === "awaiting-approval" && slotIndex === 3 && toolName) {
    return { svg: toolInfoSVG(toolName), title: toolName };
  }

  const layout = LAYOUTS[state];
  if (!layout) return EMPTY;
  return layout[slotIndex] ?? EMPTY;
}

/** Get the full layout definition for a state. */
export function getLayout(state: string): LayoutDef {
  return LAYOUTS[state] ?? {};
}

/** List all known states that have layout definitions. */
export function getLayoutStates(): string[] {
  return Object.keys(LAYOUTS);
}
