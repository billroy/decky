/**
 * Shared helpers for all MCP tool modules.
 */

import { bridge, formatBridgeError } from "../bridge-client.js";

export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function fail(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

/**
 * Resolve a slot address from {index} or {row, col} to a 0-based linear index.
 * row/col resolution requires a deck heartbeat from the bridge.
 */
export async function resolveSlotIndex(
  input: { index?: number; row?: number; col?: number },
): Promise<{ index: number } | { error: string }> {
  if (typeof input.index === "number") return { index: input.index };
  if (typeof input.row === "number" && typeof input.col === "number") {
    try {
      const status = await bridge.get<Record<string, unknown>>("/status");
      const deck = status.deck as { cols: number } | null;
      if (!deck || deck.cols <= 0) {
        return {
          error:
            "No deck heartbeat data available (or deck cols=0). Provide an index or ensure the Stream Deck plugin is connected.",
        };
      }
      return { index: input.row * deck.cols + input.col };
    } catch (e) {
      return { error: formatBridgeError(e) };
    }
  }
  return { error: "Must provide either 'index' or both 'row' and 'col'." };
}
