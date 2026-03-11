#!/usr/bin/env node
/**
 * Decky MCP server entry point.
 * Launched by: npx @decky/mcp  OR  claude mcp add decky --command npx -- -y @decky/mcp
 */
export {};
await import("../src/server.js");
