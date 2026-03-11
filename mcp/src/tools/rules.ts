/**
 * Always-allow rule tools:
 *   decky_list_always_allow_rules, decky_add_always_allow_rule, decky_delete_always_allow_rule
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bridge, formatBridgeError } from "../bridge-client.js";
import { ok, fail } from "./helpers.js";

type AlwaysAllowRule = { id: string; pattern: string; createdAt?: number };

export function registerRulesTools(server: McpServer): void {
  // --- decky_list_always_allow_rules ---
  server.registerTool(
    "decky_list_always_allow_rules",
    {
      description:
        "List all always-allow rules. Tools matching these patterns are automatically approved " +
        "without showing the approval UI on the Stream Deck. " +
        "Patterns support trailing wildcard '*' (e.g. 'Read*' matches ReadFile, Read, etc.) " +
        "or exact match.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await bridge.get<{ rules: AlwaysAllowRule[] }>("/rules");
        return ok({
          count: result.rules.length,
          rules: result.rules.map((r) => ({
            id: r.id,
            pattern: r.pattern,
            createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
          })),
        });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_add_always_allow_rule ---
  server.registerTool(
    "decky_add_always_allow_rule",
    {
      description:
        "Add a new always-allow rule. Tools whose names match the pattern will be auto-approved " +
        "without Stream Deck interaction. Use 'ToolName' for exact match or 'Read*' for prefix wildcard.",
      inputSchema: z.object({
        pattern: z
          .string()
          .min(1)
          .max(200)
          .describe("Tool name pattern. Exact or trailing wildcard (e.g. 'Bash' or 'Read*')."),
      }),
    },
    async ({ pattern }) => {
      try {
        const result = await bridge.post<{ ok: boolean; rules: AlwaysAllowRule[] }>("/rules", {
          pattern,
        });
        const added = result.rules.find((r) => r.pattern === pattern);
        return ok({
          success: true,
          id: added?.id ?? null,
          pattern,
          totalRules: result.rules.length,
        });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_delete_always_allow_rule ---
  server.registerTool(
    "decky_delete_always_allow_rule",
    {
      description:
        "Delete an always-allow rule by ID or pattern. " +
        "If a pattern is provided and matches multiple rules, the first match is deleted. " +
        "Use decky_list_always_allow_rules to see current rules and their IDs.",
      inputSchema: z.object({
        id: z.string().optional().describe("Rule ID (exact). Preferred over pattern."),
        pattern: z
          .string()
          .optional()
          .describe("Pattern to match against existing rules (first match deleted)."),
      }),
    },
    async ({ id, pattern }) => {
      if (!id && !pattern) {
        return fail("Provide either 'id' or 'pattern'.");
      }

      try {
        let resolvedId = id;

        if (!resolvedId && pattern) {
          const list = await bridge.get<{ rules: AlwaysAllowRule[] }>("/rules");
          const match = list.rules.find((r) => r.pattern === pattern);
          if (!match) {
            return fail(`No always-allow rule found with pattern '${pattern}'.`);
          }
          resolvedId = match.id;
        }

        const result = await bridge.delete<{ ok: boolean; rules: AlwaysAllowRule[] }>(
          `/rules/${resolvedId}`,
        );
        return ok({
          success: true,
          deletedId: resolvedId,
          remainingRules: result.rules.length,
        });
      } catch (e) {
        return fail(formatBridgeError(e));
      }
    },
  );
}
