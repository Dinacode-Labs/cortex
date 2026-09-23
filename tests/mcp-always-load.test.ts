import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../apps/mcp-server/src/server.js";

const ALWAYS_LOAD = "anthropic/alwaysLoad";
const READ_TOOLS = ["ask_project_context", "get_project_context_pack", "list_project_decisions", "search_project_context"];

/**
 * Claude Code defers every MCP tool behind ToolSearch, and sessions that never loaded Cortex's
 * tools never asked it anything: they answered from the repository. `_meta["anthropic/alwaysLoad"]`
 * is how a tool opts out of that, per tool. The read tools must carry it — or the lookup goes back
 * to being a two-step detour — and nothing else may: a write or maintenance tool loaded up front is
 * context every session pays for and almost none uses (ADR-0075).
 */
describe("the tools Claude Code loads from the first turn", () => {
  it("are exactly the four read tools", async () => {
    const [toServer, toClient] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer();
    await server.connect(toServer);
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(toClient);
    try {
      const { tools } = await client.listTools();
      const alwaysLoaded = tools.filter((t) => t._meta?.[ALWAYS_LOAD] === true).map((t) => t.name).sort();
      expect(alwaysLoaded).toEqual(READ_TOOLS);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
