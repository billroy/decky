/**
 * Decky MCP server — stdio transport.
 * Registers all tool modules and connects to the Decky bridge at localhost:9130.
 *
 * Read-only mode: when the bridge config has readOnly: true (the default),
 * or DECKY_READONLY is not "0", config-write and color tools are not registered.
 * Override with DECKY_READONLY=0 to enable all tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerStatusTools } from "./tools/status.js";
import { registerConfigReadTools } from "./tools/config-read.js";
import { registerConfigWriteTools } from "./tools/config-write.js";
import { registerColorTools } from "./tools/colors.js";
import { registerDebugTools } from "./tools/debug.js";
import { bridge } from "./bridge-client.js";

/**
 * Determine if write tools should be registered.
 * DECKY_READONLY=0 always enables writes (for testing).
 * Otherwise, probe the bridge config for readOnly setting.
 */
async function shouldRegisterWriteTools(): Promise<boolean> {
  const env = process.env.DECKY_READONLY;
  if (env === "0" || env === "false") return true;

  try {
    const config = await bridge.get<{ readOnly?: boolean }>("/config");
    return config.readOnly === false;
  } catch {
    // Bridge unreachable at startup — default to read-only (safe default).
    return false;
  }
}

const server = new McpServer({
  name: "decky",
  version: "0.1.0",
});

// Always register read-only tools.
registerStatusTools(server);
registerConfigReadTools(server);
registerDebugTools(server);

// Conditionally register write tools.
const writeEnabled = await shouldRegisterWriteTools();
if (writeEnabled) {
  registerConfigWriteTools(server);
  registerColorTools(server);
}

const transport = new StdioServerTransport();
await server.connect(transport);
