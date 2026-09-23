import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../apps/mcp-server/src/server.js";

const ALWAYS_LOAD = "anthropic/alwaysLoad";
const READ_TOOLS = ["ask_project_context", "get_project_context_pack", "list_project_decisions", "search_project_context"];

/**
 * Sessions that never loaded Cortex's deferred tools never asked it anything (ADR-0075). A write
 * tool loaded up front, though, is context every session pays for and almost none uses.
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
