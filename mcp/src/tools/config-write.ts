/**
 * Config write tools:
 *   decky_set_theme, decky_update_slot, decky_add_slot, decky_delete_slot,
 *   decky_reorder_slots, decky_swap_slots, decky_update_global_settings,
 *   decky_reload_config, decky_restore_config_backup
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bridge, formatBridgeError } from "../bridge-client.js";
import {
  resolveColor,
  resolveIcon,
  validateTheme,
  validateSlotType,
  validateTargetApp,
  slotSupportsIcon,
} from "../vocabularies.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

type MacroDef = Record<string, unknown>;
type DeckyConfig = {
  macros: MacroDef[];
  theme?: string;
  colors?: Record<string, string>;
  approvalTimeout?: number;
  defaultTargetApp?: string;
  showTargetBadge?: boolean;
  popUpApp?: boolean;
  enableApproveOnce?: boolean;
  enableDictation?: boolean;
  maxTokens5h?: number;
  [key: string]: unknown;
};

/** Resolve optional color fields in-place. */
function resolveColors(
  colors: { bg?: string; text?: string; icon?: string } | undefined,
): { bg?: string; text?: string; icon?: string } | undefined {
  if (!colors) return undefined;
  return {
    ...(colors.bg !== undefined ? { bg: resolveColor(colors.bg) } : {}),
    ...(colors.text !== undefined ? { text: resolveColor(colors.text) } : {}),
    ...(colors.icon !== undefined ? { icon: resolveColor(colors.icon) } : {}),
  };
}

/**
 * Resolve slot index from {index} or {row, col} using deck info in status.
 * Returns null if resolution fails.
 */
async function resolveSlotIndex(
  input: { index?: number; row?: number; col?: number },
): Promise<{ index: number } | { error: string }> {
  if (typeof input.index === "number") {
    return { index: input.index };
  }
  if (typeof input.row === "number" && typeof input.col === "number") {
    try {
      const status = await bridge.get<Record<string, unknown>>("/status");
      const deck = status.deck as
        | { cols: number; activeSlots: Array<{ row: number; col: number; index: number }> }
        | null;
      if (!deck) {
        return {
          error:
            "No deck heartbeat data available. The Stream Deck plugin must be running and connected " +
            "before row/col addressing can be used. Alternatively, provide an index.",
        };
      }
      const cols = deck.cols;
      const computed = input.row * cols + input.col;
      return { index: computed };
    } catch (e) {
      return { error: formatBridgeError(e) };
    }
  }
  return { error: "Must provide either 'index' or both 'row' and 'col'." };
}

const ColorSchema = z
  .object({
    bg: z.string().optional().describe("Background color (name or CSS value)"),
    text: z.string().optional().describe("Text color"),
    icon: z.string().optional().describe("Icon color"),
  })
  .optional();

const SlotAddressSchema = z.object({
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("0-based slot index. Use this OR row+col."),
  row: z.number().int().min(0).optional().describe("0-based row (requires col)"),
  col: z.number().int().min(0).optional().describe("0-based column (requires row)"),
});

export function registerConfigWriteTools(server: McpServer): void {
  // --- decky_set_theme ---
  server.registerTool(
    "decky_set_theme",
    {
      description:
        "Set the global Decky theme. " +
        "applyMode controls how existing color overrides are handled: " +
        "'keep' (default) preserves per-slot overrides, 'clear-page' clears global defaults, " +
        "'clear-all' wipes all color overrides.",
      inputSchema: z.object({
        theme: z.string().describe("Theme name. Use decky_list_themes to see options."),
        applyMode: z
          .enum(["keep", "clear-page", "clear-all"])
          .default("keep")
          .describe("How to handle existing color overrides"),
      }),
    },
    async ({ theme, applyMode }) => {
      const themeErr = validateTheme(theme);
      if (themeErr) return fail(themeErr);
      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const update: DeckyConfig = { ...config, theme };
        if (applyMode === "clear-all") {
          update.colors = undefined;
          if (Array.isArray(update.macros)) {
            update.macros = update.macros.map((m) => {
              const { colors: _c, ...rest } = m;
              return rest;
            });
          }
        } else if (applyMode === "clear-page") {
          update.colors = undefined;
        }
        const result = await bridge.put<{ config: DeckyConfig }>("/config", update);
        return ok({ success: true, theme: result.config.theme });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_update_slot ---
  server.registerTool(
    "decky_update_slot",
    {
      description:
        "Update an existing slot by index (or row+col). All fields except the address are optional — " +
        "omitted fields are unchanged. Named icons (e.g. 'stopsign', 'checkmark') and named colors " +
        "(e.g. 'green', 'white') are resolved automatically. " +
        "The 'icon' and 'text' fields can only be set on macro-type slots.",
      inputSchema: SlotAddressSchema.extend({
        label: z.string().optional().describe("Button label text"),
        type: z
          .string()
          .optional()
          .describe("Slot type. Use decky_list_slot_types to see options."),
        text: z.string().optional().describe("Macro text (macro type only)"),
        icon: z.string().optional().describe("Icon text or name (macro type only)"),
        fontSize: z.number().int().min(6).max(36).optional().describe("Font size"),
        targetApp: z
          .string()
          .optional()
          .describe("Target app for text injection. Use decky_list_target_apps."),
        submit: z.boolean().optional().describe("Auto-submit after injection"),
        colors: ColorSchema,
        widgetKind: z
          .enum(["bridge-status", "rate-limit"])
          .optional()
          .describe("Widget kind (widget type only)"),
        widgetRefreshMode: z
          .enum(["onClick", "interval"])
          .optional()
          .describe("Widget refresh mode"),
        widgetIntervalMinutes: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Widget refresh interval in minutes"),
      }),
    },
    async (args) => {
      const resolved = await resolveSlotIndex(args);
      if ("error" in resolved) return fail(resolved.error);
      const { index } = resolved;

      if (args.type) {
        const typeErr = validateSlotType(args.type);
        if (typeErr) return fail(typeErr);
      }
      if (args.targetApp) {
        const appErr = validateTargetApp(args.targetApp);
        if (appErr) return fail(appErr);
      }

      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const macros = Array.isArray(config.macros) ? [...config.macros] : [];
        if (index < 0 || index >= macros.length) {
          return fail(`Slot index ${index} out of range (0–${macros.length - 1}).`);
        }

        const slot = { ...macros[index] };
        const effectiveType = (args.type ?? slot.type ?? "macro") as string;

        if ((args.icon !== undefined || args.text !== undefined) && !slotSupportsIcon(effectiveType)) {
          return fail(
            `The 'icon' and 'text' fields can only be set on macro-type slots. ` +
              `Slot ${index} is type '${effectiveType}'.`,
          );
        }

        if (args.label !== undefined) slot.label = args.label;
        if (args.type !== undefined) slot.type = args.type;
        if (args.text !== undefined) slot.text = args.text;
        if (args.icon !== undefined) slot.icon = resolveIcon(args.icon);
        if (args.fontSize !== undefined) slot.fontSize = args.fontSize;
        if (args.targetApp !== undefined) slot.targetApp = args.targetApp;
        if (args.submit !== undefined) slot.submit = args.submit;
        if (args.colors !== undefined) slot.colors = resolveColors(args.colors);

        if (args.widgetKind !== undefined || args.widgetRefreshMode !== undefined || args.widgetIntervalMinutes !== undefined) {
          const widget = (slot.widget as Record<string, unknown> | undefined) ?? {};
          if (args.widgetKind !== undefined) widget.kind = args.widgetKind;
          if (args.widgetRefreshMode !== undefined) widget.refreshMode = args.widgetRefreshMode;
          if (args.widgetIntervalMinutes !== undefined) widget.intervalMinutes = args.widgetIntervalMinutes;
          slot.widget = widget;
        }

        macros[index] = slot;
        const result = await bridge.put<{ config: DeckyConfig }>("/config", { ...config, macros });
        return ok({ success: true, index, slot: result.config.macros[index] });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_add_slot ---
  server.registerTool(
    "decky_add_slot",
    {
      description:
        "Append a new slot to the Decky configuration. " +
        "NOTE: The Stream Deck SDK does not support programmatically adding buttons to the deck — " +
        "the user must manually drag a Decky Slot action onto a physical button in the Stream Deck app first. " +
        "This tool creates the config entry; the physical button must already be assigned.",
      inputSchema: z.object({
        label: z.string().describe("Button label text"),
        type: z
          .string()
          .default("macro")
          .describe("Slot type. Use decky_list_slot_types to see options."),
        text: z.string().optional().describe("Macro text (macro type only)"),
        icon: z.string().optional().describe("Icon text or name (macro type only)"),
        fontSize: z.number().int().min(6).max(36).optional(),
        targetApp: z.string().optional(),
        submit: z.boolean().optional(),
        colors: ColorSchema,
        widgetKind: z.enum(["bridge-status", "rate-limit"]).optional(),
        widgetRefreshMode: z.enum(["onClick", "interval"]).optional(),
        widgetIntervalMinutes: z.number().int().min(1).optional(),
      }),
    },
    async (args) => {
      const typeErr = validateSlotType(args.type);
      if (typeErr) return fail(typeErr);
      if (args.targetApp) {
        const appErr = validateTargetApp(args.targetApp);
        if (appErr) return fail(appErr);
      }

      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const macros = Array.isArray(config.macros) ? [...config.macros] : [];

        const newSlot: MacroDef = {
          label: args.label,
          type: args.type,
          ...(args.text !== undefined ? { text: args.text } : {}),
          ...(args.icon !== undefined ? { icon: resolveIcon(args.icon) } : {}),
          ...(args.fontSize !== undefined ? { fontSize: args.fontSize } : {}),
          ...(args.targetApp !== undefined ? { targetApp: args.targetApp } : {}),
          ...(args.submit !== undefined ? { submit: args.submit } : {}),
          ...(args.colors ? { colors: resolveColors(args.colors) } : {}),
          ...(args.widgetKind !== undefined
            ? {
                widget: {
                  kind: args.widgetKind,
                  ...(args.widgetRefreshMode ? { refreshMode: args.widgetRefreshMode } : {}),
                  ...(args.widgetIntervalMinutes ? { intervalMinutes: args.widgetIntervalMinutes } : {}),
                },
              }
            : {}),
        };

        macros.push(newSlot);
        const newIndex = macros.length - 1;
        const result = await bridge.put<{ config: DeckyConfig }>("/config", {
          ...config,
          macros,
        });

        const warnings: string[] = [];
        if (newIndex >= 15) {
          warnings.push(
            `Slot ${newIndex} exceeds the common Stream Deck button count (15). ` +
              "Make sure your deck model has enough buttons.",
          );
        }
        warnings.push(
          "Remember: a Decky Slot action must be assigned to a physical button in the " +
            "Stream Deck app for this config entry to be visible on the deck.",
        );

        return ok({
          success: true,
          index: newIndex,
          slot: result.config.macros[newIndex],
          warnings,
        });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_delete_slot ---
  server.registerTool(
    "decky_delete_slot",
    {
      description: "Delete a slot by index (or row+col).",
      inputSchema: SlotAddressSchema,
    },
    async (args) => {
      const resolved = await resolveSlotIndex(args);
      if ("error" in resolved) return fail(resolved.error);
      const { index } = resolved;

      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const macros = Array.isArray(config.macros) ? [...config.macros] : [];
        if (index < 0 || index >= macros.length) {
          return fail(`Slot index ${index} out of range (0–${macros.length - 1}).`);
        }
        macros.splice(index, 1);
        await bridge.put("/config", { ...config, macros });
        return ok({ success: true, remainingCount: macros.length });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_reorder_slots ---
  server.registerTool(
    "decky_reorder_slots",
    {
      description:
        "Reorder slots by providing the new index order as a permutation array. " +
        "For example, [1, 0, 2] swaps the first two slots.",
      inputSchema: z.object({
        newOrder: z
          .array(z.number().int().min(0))
          .describe("Permutation of [0..n-1] where n is current slot count"),
      }),
    },
    async ({ newOrder }) => {
      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const macros = Array.isArray(config.macros) ? config.macros : [];
        const n = macros.length;

        const sorted = [...newOrder].sort((a, b) => a - b);
        const isValidPermutation =
          newOrder.length === n && sorted.every((v, i) => v === i);
        if (!isValidPermutation) {
          return fail(
            `newOrder must be a permutation of [0..${n - 1}]. Got: [${newOrder.join(", ")}]`,
          );
        }

        const reordered = newOrder.map((i) => macros[i]);
        const result = await bridge.put<{ config: DeckyConfig }>("/config", {
          ...config,
          macros: reordered,
        });
        return ok({ success: true, slots: result.config.macros });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_swap_slots ---
  server.registerTool(
    "decky_swap_slots",
    {
      description: "Swap two slots by index. Useful for 'switch the Push and MakePR icons'.",
      inputSchema: z.object({
        indexA: z.number().int().min(0).describe("First slot index"),
        indexB: z.number().int().min(0).describe("Second slot index"),
      }),
    },
    async ({ indexA, indexB }) => {
      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const macros = Array.isArray(config.macros) ? [...config.macros] : [];
        if (indexA >= macros.length || indexB >= macros.length) {
          return fail(
            `Index out of range. Current slot count: ${macros.length}. Got indexA=${indexA}, indexB=${indexB}.`,
          );
        }
        [macros[indexA], macros[indexB]] = [macros[indexB], macros[indexA]];
        await bridge.put("/config", { ...config, macros });
        return ok({ success: true, swapped: [indexA, indexB] });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_update_global_settings ---
  server.registerTool(
    "decky_update_global_settings",
    {
      description:
        "Update global Decky settings without touching the macros array. All fields are optional.",
      inputSchema: z.object({
        approvalTimeout: z
          .number()
          .int()
          .min(5)
          .max(300)
          .optional()
          .describe("Approval timeout in seconds (5–300)"),
        defaultTargetApp: z
          .string()
          .optional()
          .describe("Default target app. Use decky_list_target_apps."),
        showTargetBadge: z.boolean().optional().describe("Show app badge on buttons"),
        popUpApp: z.boolean().optional().describe("Auto-surface Claude.app on approval"),
        enableApproveOnce: z.boolean().optional().describe("Enable approve-and-activate feature"),
        enableDictation: z.boolean().optional().describe("Enable voice input (macOS only)"),
        maxTokens5h: z
          .number()
          .int()
          .min(1000)
          .optional()
          .describe("5-hour token limit for rate-limit widget"),
      }),
    },
    async (args) => {
      if (args.defaultTargetApp) {
        const appErr = validateTargetApp(args.defaultTargetApp);
        if (appErr) return fail(appErr);
      }
      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const update: DeckyConfig = { ...config };
        const fields: (keyof typeof args)[] = [
          "approvalTimeout",
          "defaultTargetApp",
          "showTargetBadge",
          "popUpApp",
          "enableApproveOnce",
          "enableDictation",
          "maxTokens5h",
        ];
        for (const field of fields) {
          if (args[field] !== undefined) {
            (update as Record<string, unknown>)[field] = args[field];
          }
        }
        const result = await bridge.put<{ config: DeckyConfig }>("/config", update);
        const { macros: _m, ...settings } = result.config;
        return ok({ success: true, settings });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_reload_config ---
  server.registerTool(
    "decky_reload_config",
    {
      description: "Reload the Decky configuration from disk. Use this to pick up manual edits to ~/.decky/config.json.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        await bridge.post("/config/reload");
        return ok({ success: true });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_restore_config_backup ---
  server.registerTool(
    "decky_restore_config_backup",
    {
      description:
        "Restore a configuration backup by index. Use decky_get_config_backups to list available backups.",
      inputSchema: z.object({
        index: z.number().int().min(0).describe("Backup index (0 = most recent)"),
      }),
    },
    async ({ index }) => {
      try {
        const result = await bridge.post<{ config: DeckyConfig; restoredIndex: number }>(
          "/config/restore",
          { index },
        );
        return ok({
          success: true,
          restoredIndex: result.restoredIndex,
          macroCount: result.config.macros?.length ?? 0,
        });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );
}
