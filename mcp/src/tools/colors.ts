/**
 * Color tools:
 *   decky_set_slot_colors, decky_set_global_colors,
 *   decky_reset_slot_colors, decky_reset_all_colors
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bridge, formatBridgeError } from "../bridge-client.js";
import { resolveColor } from "../vocabularies.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

type DeckyConfig = {
  macros: Array<Record<string, unknown>>;
  colors?: Record<string, string>;
  [key: string]: unknown;
};

const ColorSchema = z.object({
  bg: z.string().optional().describe("Background color (name or CSS hex value)"),
  text: z.string().optional().describe("Text color"),
  icon: z.string().optional().describe("Icon color"),
});

const SlotAddressSchema = z.object({
  index: z.number().int().min(0).optional().describe("0-based slot index. Use this OR row+col."),
  row: z.number().int().min(0).optional().describe("0-based row (requires col)"),
  col: z.number().int().min(0).optional().describe("0-based column (requires row)"),
});

async function resolveSlotIndex(
  input: { index?: number; row?: number; col?: number },
): Promise<{ index: number } | { error: string }> {
  if (typeof input.index === "number") return { index: input.index };
  if (typeof input.row === "number" && typeof input.col === "number") {
    try {
      const status = await bridge.get<Record<string, unknown>>("/status");
      const deck = status.deck as { cols: number } | null;
      if (!deck) {
        return {
          error:
            "No deck heartbeat data available. Provide an index or ensure the Stream Deck plugin is running.",
        };
      }
      return { index: input.row * deck.cols + input.col };
    } catch (e) {
      return { error: formatBridgeError(e) };
    }
  }
  return { error: "Must provide either 'index' or both 'row' and 'col'." };
}

function resolveColorFields(
  colors: { bg?: string; text?: string; icon?: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  if (colors.bg !== undefined) out.bg = resolveColor(colors.bg);
  if (colors.text !== undefined) out.text = resolveColor(colors.text);
  if (colors.icon !== undefined) out.icon = resolveColor(colors.icon);
  return out;
}

export function registerColorTools(server: McpServer): void {
  // --- decky_set_slot_colors ---
  server.registerTool(
    "decky_set_slot_colors",
    {
      description:
        "Set color overrides on a specific slot (by index or row+col). " +
        "Accepts CSS hex values or named colors — use decky_list_color_names to see options. " +
        "Omit any color field to leave it unchanged.",
      inputSchema: SlotAddressSchema.extend({
        colors: ColorSchema.describe("Color fields to set on the slot"),
      }),
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

        const slot = { ...macros[index] };
        const existing = (slot.colors as Record<string, string> | undefined) ?? {};
        slot.colors = { ...existing, ...resolveColorFields(args.colors) };
        macros[index] = slot;

        const result = await bridge.put<{ config: DeckyConfig }>("/config", { ...config, macros });
        return ok({ success: true, index, colors: result.config.macros[index].colors });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_set_global_colors ---
  server.registerTool(
    "decky_set_global_colors",
    {
      description:
        "Set global color defaults that apply to all slots without per-slot overrides. " +
        "Accepts CSS hex values or named colors.",
      inputSchema: z.object({
        colors: ColorSchema.describe("Global color defaults to set"),
      }),
    },
    async ({ colors }) => {
      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const existing = config.colors ?? {};
        const updated = { ...config, colors: { ...existing, ...resolveColorFields(colors) } };
        const result = await bridge.put<{ config: DeckyConfig }>("/config", updated);
        return ok({ success: true, colors: result.config.colors });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_reset_slot_colors ---
  server.registerTool(
    "decky_reset_slot_colors",
    {
      description:
        "Remove all color overrides from a specific slot, reverting it to the theme/global defaults.",
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

        const { colors: _removed, ...slotWithoutColors } = macros[index];
        macros[index] = slotWithoutColors;

        await bridge.put("/config", { ...config, macros });
        return ok({ success: true, index });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_reset_all_colors ---
  server.registerTool(
    "decky_reset_all_colors",
    {
      description:
        "Remove all color overrides globally and from every slot, reverting to pure theme defaults.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const config = await bridge.get<DeckyConfig>("/config");
        const { colors: _gc, ...configWithoutColors } = config;
        const macros = Array.isArray(config.macros)
          ? config.macros.map((m) => {
              const { colors: _sc, ...rest } = m;
              return rest;
            })
          : [];
        await bridge.put("/config", { ...configWithoutColors, macros });
        return ok({ success: true });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );
}
