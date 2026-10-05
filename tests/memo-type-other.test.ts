import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../apps/mcp-server/src/server.js";
import { captureRequest, searchRequest } from "../packages/shared/src/api-contract";
import { contextEntryType, saveContextInput, searchContextInput } from "../packages/shared/src/domain";
import { classifyType } from "../packages/core/src/text";
import { PACK_SECTIONS } from "../packages/core/src/knowledge/context-pack";

/**
 * `module_note` hid that it was the catch-all, so it became `other` (ADR-0079); CLIs installed
 * before the rename still send the old name, and refusing it would turn their saves into a 400.
 */
describe("the type a memo falls into when nothing else fits is called other", () => {
  it("a memo no rule recognises is classified as other", () => {
    expect(classifyType("Lorem ipsum dolor sit amet.")).toBe("other");
  });

  it("the catch-all is the last section of the pack, so it is the first to give when the pack is over budget", () => {
    expect(PACK_SECTIONS.at(-1)?.type).toBe("other");
  });

  it("module_note is no longer a type a memo can have", () => {
    expect(contextEntryType.options).toContain("other");
    expect(contextEntryType.options).not.toContain("module_note");
  });

  it("a caller that still sends module_note gets an other, on every way in", () => {
    const received = {
      saveContextInput: saveContextInput.parse({ content: "x", type: "module_note" }).type,
      searchContextInput: searchContextInput.parse({ query: "x", type: "module_note" }).type,
      captureRequest: captureRequest.parse({ slug: "p", content: "x", type: "module_note" }).type,
      searchRequest: searchRequest.parse({ q: "x", type: "module_note" }).type,
    };
    expect(received).toEqual({
      saveContextInput: "other",
      searchContextInput: "other",
      captureRequest: "other",
      searchRequest: "other",
    });
  });

  it("the alias does not open the enum: an unknown type is still rejected", () => {
    expect(saveContextInput.safeParse({ content: "x", type: "note" }).success).toBe(false);
    expect(saveContextInput.safeParse({ content: "x", type: "constructor" }).success).toBe(false);
  });

  it("the MCP tools offer other to the agent and no longer offer module_note", async () => {
    const [toServer, toClient] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer();
    await server.connect(toServer);
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(toClient);
    try {
      const { tools } = await client.listTools();
      const offered = Object.fromEntries(
        ["save_project_context", "search_project_context"].map((name) => {
          const schema = tools.find((t) => t.name === name)?.inputSchema as
            | { properties?: { type?: { enum?: string[] } } }
            | undefined;
          return [name, schema?.properties?.type?.enum ?? []];
        }),
      );
      for (const types of Object.values(offered)) {
        expect(types).toContain("other");
        expect(types).not.toContain("module_note");
      }
      expect(offered).toEqual({
        save_project_context: contextEntryType.options,
        search_project_context: contextEntryType.options,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
