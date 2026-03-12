/**
 * MCP tool integration tests.
 * Uses a mock bridge client to test all tool modules without a real bridge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// ---- Bridge mock ----
const mockBridge = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

vi.mock("../bridge-client.js", () => ({
  bridge: mockBridge,
  BridgeUnreachableError: class BridgeUnreachableError extends Error {},
  formatBridgeError: (e: unknown) => String(e),
  DEFAULT_BASE_URL: "http://localhost:9130",
}));

// ---- Tool registration helpers ----
async function makeServer(): Promise<{ client: Client; server: McpServer }> {
  const { registerStatusTools } = await import("../tools/status.js");
  const { registerConfigReadTools } = await import("../tools/config-read.js");
  const { registerConfigWriteTools } = await import("../tools/config-write.js");
  const { registerColorTools } = await import("../tools/colors.js");
  const { registerDebugTools } = await import("../tools/debug.js");

  const server = new McpServer({ name: "test-decky", version: "0.0.1" });
  registerStatusTools(server);
  registerConfigReadTools(server);
  registerConfigWriteTools(server);
  registerColorTools(server);
  registerDebugTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text ?? "";
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

// ---- Tests ----

describe("status tools", () => {
  let client: Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ client } = await makeServer());
  });

  it("decky_probe_bridge returns reachable=true when bridge responds", async () => {
    mockBridge.get.mockResolvedValue({ state: "idle", uptimeSeconds: 42 });
    const text = await callTool(client, "decky_probe_bridge");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.reachable).toBe(true);
    expect(data.state).toBe("idle");
  });

  it("decky_probe_bridge returns reachable=false on ECONNREFUSED", async () => {
    const { BridgeUnreachableError } = await import("../bridge-client.js");
    mockBridge.get.mockRejectedValue(new BridgeUnreachableError("ECONNREFUSED"));
    const text = await callTool(client, "decky_probe_bridge");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.reachable).toBe(false);
  });

  it("decky_get_status returns connected status", async () => {
    mockBridge.get.mockResolvedValue({
      state: "thinking",
      previousState: "idle",
      tool: "Bash",
      approval: null,
      deck: null,
      uptimeSeconds: 100,
    });
    const text = await callTool(client, "decky_get_status");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.connected).toBe(true);
    expect(data.state).toBe("thinking");
  });

});

describe("config read tools", () => {
  let client: Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ client } = await makeServer());
  });

  it("decky_get_config returns config", async () => {
    const mockConfig = { theme: "dark", macros: [{ label: "Push", type: "macro" }] };
    mockBridge.get.mockResolvedValue(mockConfig);
    const text = await callTool(client, "decky_get_config");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.theme).toBe("dark");
  });

  it("decky_list_themes returns array of themes", async () => {
    const text = await callTool(client, "decky_list_themes");
    const data = parseJson(text) as Record<string, unknown>;
    const themes = data.themes as Array<{ name: string; description: string }>;
    expect(Array.isArray(themes)).toBe(true);
    expect(themes.length).toBeGreaterThan(0);
    expect(themes.some((t) => t.name === "light")).toBe(true);
  });

  it("decky_list_icons returns icons map", async () => {
    const text = await callTool(client, "decky_list_icons");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.icons).toBeDefined();
    expect(typeof data.icons).toBe("object");
  });

  it("decky_get_config_backups returns backups array", async () => {
    mockBridge.get.mockResolvedValue({ backups: ["backup-1", "backup-2"] });
    const text = await callTool(client, "decky_get_config_backups");
    const data = parseJson(text) as Record<string, unknown>;
    expect(Array.isArray(data.backups)).toBe(true);
  });
});

describe("config write tools", () => {
  let client: Client;
  const baseConfig = {
    theme: "light",
    macros: [
      { label: "Push", type: "macro", text: "git push", icon: "🚀" },
      { label: "Status", type: "macro", text: "git status" },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ client } = await makeServer());
  });

  it("decky_set_theme updates theme", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    mockBridge.put.mockResolvedValue({ config: { ...baseConfig, theme: "dracula" } });
    const text = await callTool(client, "decky_set_theme", { theme: "dracula" });
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect(data.theme).toBe("dracula");
  });

  it("decky_set_theme returns error for invalid theme", async () => {
    const text = await callTool(client, "decky_set_theme", { theme: "notatheme" });
    expect(text).toContain("Error:");
  });

  it("decky_update_slot updates a macro label", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    const updatedMacros = [...baseConfig.macros];
    updatedMacros[0] = { ...updatedMacros[0], label: "NewLabel" };
    mockBridge.put.mockResolvedValue({ config: { ...baseConfig, macros: updatedMacros } });
    const text = await callTool(client, "decky_update_slot", { index: 0, label: "NewLabel" });
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it("decky_update_slot resolves named color", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    const updatedMacros: Array<Record<string, unknown>> = [...baseConfig.macros];
    updatedMacros[0] = { ...updatedMacros[0], colors: { bg: "#22c55e" } };
    mockBridge.put.mockResolvedValue({ config: { ...baseConfig, macros: updatedMacros } });
    await callTool(client, "decky_update_slot", { index: 0, colors: { bg: "green" } });
    const putCall = mockBridge.put.mock.calls[0];
    const config = putCall[1] as { macros: Array<{ colors?: { bg: string } }> };
    // green should resolve to a hex value
    expect(config.macros[0].colors?.bg).toMatch(/^#/);
  });

  it("decky_swap_slots swaps two macros", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    mockBridge.put.mockResolvedValue({ config: baseConfig });
    const text = await callTool(client, "decky_swap_slots", { indexA: 0, indexB: 1 });
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.success).toBe(true);
    // Verify the put was called with swapped macros
    const putCall = mockBridge.put.mock.calls[0];
    const config = putCall[1] as { macros: Array<{ label: string }> };
    expect(config.macros[0].label).toBe("Status");
    expect(config.macros[1].label).toBe("Push");
  });

  it("decky_delete_slot removes a macro", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    mockBridge.put.mockResolvedValue({ config: { ...baseConfig, macros: [baseConfig.macros[1]] } });
    const text = await callTool(client, "decky_delete_slot", { index: 0 });
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect(data.remainingCount).toBe(1);
  });

  it("decky_reload_config calls POST /config/reload", async () => {
    mockBridge.post.mockResolvedValue({});
    await callTool(client, "decky_reload_config");
    expect(mockBridge.post).toHaveBeenCalledWith("/config/reload");
  });

  it("decky_reorder_slots reorders macros correctly", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    const reordered = [baseConfig.macros[1], baseConfig.macros[0]];
    mockBridge.put.mockResolvedValue({ config: { ...baseConfig, macros: reordered } });
    const text = await callTool(client, "decky_reorder_slots", { newOrder: [1, 0] });
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.success).toBe(true);
    // Verify put was called with swapped order
    const putCall = mockBridge.put.mock.calls[0];
    const config = putCall[1] as { macros: Array<{ label: string }> };
    expect(config.macros[0].label).toBe("Status");
    expect(config.macros[1].label).toBe("Push");
  });

  it("decky_reorder_slots rejects wrong-length permutation", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    const text = await callTool(client, "decky_reorder_slots", { newOrder: [0] });
    expect(text).toContain("Error:");
  });

  it("decky_reorder_slots rejects permutation with duplicate index", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    const text = await callTool(client, "decky_reorder_slots", { newOrder: [0, 0] });
    expect(text).toContain("Error:");
  });
});

describe("color tools", () => {
  let client: Client;
  const baseConfig = {
    theme: "light",
    macros: [{ label: "Push", type: "macro", text: "git push" }],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ client } = await makeServer());
  });

  it("decky_set_slot_colors sets colors on a slot", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    const updated = { ...baseConfig, macros: [{ ...baseConfig.macros[0], colors: { bg: "#22c55e" } }] };
    mockBridge.put.mockResolvedValue({ config: updated });
    const text = await callTool(client, "decky_set_slot_colors", {
      index: 0,
      colors: { bg: "green" },
    });
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it("decky_set_global_colors sets global colors", async () => {
    mockBridge.get.mockResolvedValue({ ...baseConfig });
    mockBridge.put.mockResolvedValue({ config: { ...baseConfig, colors: { bg: "#111111" } } });
    const text = await callTool(client, "decky_set_global_colors", {
      colors: { bg: "#111111" },
    });
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it("decky_reset_all_colors removes all color fields", async () => {
    const configWithColors = {
      ...baseConfig,
      colors: { bg: "#000" },
      macros: [{ label: "X", type: "macro", colors: { bg: "#fff" } }],
    };
    mockBridge.get.mockResolvedValue(configWithColors);
    mockBridge.put.mockResolvedValue({ config: baseConfig });
    const text = await callTool(client, "decky_reset_all_colors");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.success).toBe(true);
    // Verify put was called without global colors
    const putCall = mockBridge.put.mock.calls[0];
    const config = putCall[1] as Record<string, unknown>;
    expect(config.colors).toBeUndefined();
  });
});

describe("debug tools", () => {
  let client: Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ client } = await makeServer());
  });

  it("decky_get_debug_trace returns trace summary", async () => {
    mockBridge.get.mockResolvedValue({
      traces: [
        { tool: "Bash", outcome: "approved", flow: "mirror", createdAt: Date.now() },
      ],
      approvalQueue: [],
      now: Date.now(),
    });
    const text = await callTool(client, "decky_get_debug_trace");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.count).toBe(1);
    expect(Array.isArray(data.summary)).toBe(true);
  });

  it("decky_get_pi_debug_status returns bridge state", async () => {
    const statusMock = { state: "idle", uptimeSeconds: 50, deck: null };
    const configMock = { theme: "dark", macros: [{ label: "X" }], alwaysAllowRules: [] };
    mockBridge.get
      .mockResolvedValueOnce(statusMock)
      .mockResolvedValueOnce(configMock);
    const text = await callTool(client, "decky_get_pi_debug_status");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.bridgeConnected).toBe(true);
    expect(data.macroCount).toBe(1);
  });

  it("decky_get_logs returns lines array", async () => {
    mockBridge.get.mockResolvedValue({ lines: ["[2026-01-01] info: bridge started"] });
    const text = await callTool(client, "decky_get_logs");
    const data = parseJson(text) as Record<string, unknown>;
    expect(Array.isArray(data.lines)).toBe(true);
  });

  it("decky_get_logs handles 404 gracefully", async () => {
    mockBridge.get.mockRejectedValue(new Error("404 Not Found"));
    const text = await callTool(client, "decky_get_logs");
    const data = parseJson(text) as Record<string, unknown>;
    expect(data.count).toBe(0);
    expect(data.note).toBeDefined();
  });
});
