/**
 * Debug / introspection tools:
 *   decky_get_debug_trace, decky_get_debug_info,
 *   decky_get_pi_debug_status, decky_get_logs
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bridge, BridgeUnreachableError, formatBridgeError } from "../bridge-client.js";
import { ok, fail } from "./helpers.js";

export function registerDebugTools(server: McpServer): void {
  // --- decky_get_debug_trace ---
  server.registerTool(
    "decky_get_debug_trace",
    {
      description:
        "Return recent approval-trace history from the bridge. " +
        "Requires DECKY_DEBUG=1 on the bridge process — returns a 403 if debug mode is off. " +
        "Includes both the human-readable summary and raw trace objects.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum number of trace entries to return (1–100, default 25)"),
      }),
    },
    async ({ limit }) => {
      try {
        const data = await bridge.get<{
          traces: Array<Record<string, unknown>>;
          approvalQueue: Array<Record<string, unknown>>;
          now: number;
        }>(`/debug/approval-trace?limit=${limit}`);

        const summary = data.traces.map((t) => {
          const ts = t.completedAt ?? t.createdAt;
          const time = ts ? new Date(ts as number).toISOString() : "?";
          return `[${time}] ${t.tool ?? "?"} → ${t.outcome ?? "?"} (${t.flow ?? "?"})`;
        });

        return ok({
          count: data.traces.length,
          summary,
          traces: data.traces,
          queueDepth: data.approvalQueue.length,
          approvalQueue: data.approvalQueue,
          fetchedAt: new Date(data.now).toISOString(),
        });
      } catch (e) {
        if (e instanceof BridgeUnreachableError) {
          return fail("Bridge is not running.");
        }
        const msg = formatBridgeError(e);
        if (msg.includes("403")) {
          return fail(
            "Debug mode is off. Start the bridge with DECKY_DEBUG=1 to enable approval traces.",
          );
        }
        return fail(msg);
      }
    },
  );

  // --- decky_get_debug_info ---
  server.registerTool(
    "decky_get_debug_info",
    {
      description:
        "Return a comprehensive debug snapshot: bridge status, current config summary, " +
        "and approval trace (if DECKY_DEBUG=1). Useful for diagnosing issues.",
      inputSchema: z.object({}),
    },
    async () => {
      const results: Record<string, unknown> = {};

      try {
        const status = await bridge.get<Record<string, unknown>>("/status");
        results.status = status;
      } catch (e) {
        results.status = { error: formatBridgeError(e) };
      }

      try {
        const config = await bridge.get<Record<string, unknown>>("/config");
        const macros = Array.isArray(config.macros) ? config.macros : [];
        results.configSummary = {
          macroCount: macros.length,
          theme: config.theme ?? null,
          approvalTimeout: config.approvalTimeout ?? null,
          defaultTargetApp: config.defaultTargetApp ?? null,
          alwaysAllowRuleCount: Array.isArray(config.alwaysAllowRules)
            ? config.alwaysAllowRules.length
            : 0,
          macroLabels: macros.map((m: Record<string, unknown>) => m.label ?? "(unlabeled)"),
        };
      } catch (e) {
        results.configSummary = { error: formatBridgeError(e) };
      }

      try {
        const trace = await bridge.get<Record<string, unknown>>("/debug/approval-trace?limit=10");
        results.recentTraces = trace;
      } catch {
        results.recentTraces = {
          note: "Not available. Start bridge with DECKY_DEBUG=1 to enable.",
        };
      }

      return ok(results);
    },
  );

  // --- decky_get_pi_debug_status ---
  server.registerTool(
    "decky_get_pi_debug_status",
    {
      description:
        "Return a quick status summary useful for debugging the Property Inspector (PI): " +
        "macro count, theme, last config update timestamp, and bridge connectivity.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const [status, config] = await Promise.all([
          bridge.get<Record<string, unknown>>("/status"),
          bridge.get<Record<string, unknown>>("/config"),
        ]);

        const macros = Array.isArray(config.macros) ? config.macros : [];
        return ok({
          bridgeConnected: true,
          bridgeState: status.state ?? null,
          uptimeSeconds: status.uptimeSeconds ?? null,
          macroCount: macros.length,
          theme: config.theme ?? null,
          alwaysAllowRules: Array.isArray(config.alwaysAllowRules)
            ? config.alwaysAllowRules.length
            : 0,
          deck: status.deck ?? null,
        });
      } catch (e) {
        if (e instanceof BridgeUnreachableError) {
          return ok({ bridgeConnected: false, error: "Bridge not running" });
        }
        return fail(formatBridgeError(e));
      }
    },
  );

  // --- decky_get_logs ---
  server.registerTool(
    "decky_get_logs",
    {
      description:
        "Return recent bridge log lines. " +
        "Requires bridge to be running with log buffering enabled (bridge v0.7+).",
      inputSchema: z.object({
        lines: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Number of recent log lines to return (1–500, default 50)"),
        level: z
          .enum(["all", "error", "warn"])
          .default("all")
          .describe("Filter by log level"),
      }),
    },
    async ({ lines, level }) => {
      try {
        const params = new URLSearchParams({
          lines: String(lines),
          level,
        });
        const data = await bridge.get<{ lines: string[] }>(`/logs?${params}`);
        return ok({
          count: data.lines.length,
          lines: data.lines,
        });
      } catch (e) {
        if (e instanceof BridgeUnreachableError) {
          return fail("Bridge is not running.");
        }
        const msg = formatBridgeError(e);
        if (msg.includes("404")) {
          return ok({
            count: 0,
            lines: [],
            note:
              "The /logs endpoint is not available on this bridge version. " +
              "Upgrade to bridge v0.7+ to enable log streaming.",
          });
        }
        return fail(msg);
      }
    },
  );
}
