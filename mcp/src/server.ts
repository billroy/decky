/**
 * Decky MCP server — stdio transport.
 * Registers all tool modules and connects to the Decky bridge at localhost:9130.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerStatusTools } from "./tools/status.js";
import { registerConfigReadTools } from "./tools/config-read.js";
import { registerConfigWriteTools } from "./tools/config-write.js";
import { registerColorTools } from "./tools/colors.js";
import { registerRulesTools } from "./tools/rules.js";
import { registerDebugTools } from "./tools/debug.js";

const server = new McpServer({
  name: "decky",
  version: "0.1.0",
});

registerStatusTools(server);
registerConfigReadTools(server);
registerConfigWriteTools(server);
registerColorTools(server);
registerRulesTools(server);
registerDebugTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
