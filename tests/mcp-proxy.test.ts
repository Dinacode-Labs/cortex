import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { createMcpProxy, isAuthError } from "../apps/cli/src/mcp/proxy.js";

/**
 * The proxy is the only MCP agents will see after ADR-0025, so what has to be guaranteed is not
 * merely that it forwards: it is that **the agent starts all the same** when the server does
 * not answer or the token has expired. An MCP that fails to initialise costs the agent its
 * whole session, and that is worse than having no memory.
 *
 * Everything runs in memory: a real `McpServer` plays the remote server and the proxy talks to
 * it over a pair of linked transports, with no network and no Postgres.
 */

/** A fake "remote" server with an `echo` tool. */
function upstreamServer(): McpServer {
  const server = new McpServer({ name: "cortex-upstream", version: "0.0.0" });
  server.registerTool(
    "echo",
    { title: "Echo", description: "Returns whatever you send it", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text" as const, text: `eco: ${text}` }] }),
  );
  return server;
}

/** Stands up the proxy plus a test client. `connect` counts the upstream connections. */
async function harness(connect: () => Promise<Transport>) {
  const { server, close } = createMcpProxy({ connect, log: () => {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(a);
  return { client, close: async () => { await client.close(); await close(); } };
}

/** A transport linked to a freshly started `McpServer`. */
async function linkedUpstream(server: McpServer): Promise<Transport> {
  const [toServer, toClient] = InMemoryTransport.createLinkedPair();
  await server.connect(toServer);
  return toClient;
}

describe("createMcpProxy", () => {
  it("forwards the tool list along with its inputSchema", async () => {
    const up = upstreamServer();
    const { client, close } = await harness(() => linkedUpstream(up));
    try {
      const { tools } = await client.listTools();
      const echo = tools.find((t) => t.name === "echo");
      expect(echo).toBeDefined();
      // The JSON Schema travels as is: the proxy rebuilds nothing with zod.
      expect(echo!.inputSchema.properties).toHaveProperty("text");
    } finally {
      await close();
    }
  });

  it("forwards the call and returns the server's result", async () => {
    const up = upstreamServer();
    const { client, close } = await harness(() => linkedUpstream(up));
    try {
      const res = (await client.callTool({ name: "echo", arguments: { text: "hola" } })) as {
        content: { type: string; text: string }[];
      };
      expect(res.content[0]!.text).toBe("eco: hola");
    } finally {
      await close();
    }
  });

  it("with no session the agent STARTS: an empty listTools and a callTool with a sign-in notice", async () => {
    const connect = async (): Promise<Transport> => {
      throw Object.assign(new Error("not authenticated"), { code: 401 });
    };
    const { client, close } = await harness(connect);
    try {
      // The point: `listTools` does not throw, or the agent would never start.
      expect((await client.listTools()).tools).toEqual([]);
      const res = (await client.callTool({ name: "echo", arguments: { text: "x" } })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("cortex auth login");
    } finally {
      await close();
    }
  });

  it("when the server closes the connection, it reconnects once and the call works", async () => {
    const up = upstreamServer();
    let conexiones = 0;
    let ultimo: Transport | null = null;
    const connect = async (): Promise<Transport> => {
      conexiones++;
      ultimo = await linkedUpstream(up);
      return ultimo;
    };
    const { client, close } = await harness(connect);
    try {
      await client.callTool({ name: "echo", arguments: { text: "1" } });
      expect(conexiones).toBe(1);

      // Simulates the cut: a server restart, a reverse proxy closing the stream...
      await ultimo!.close?.();
      const res = (await client.callTool({ name: "echo", arguments: { text: "2" } })) as {
        content: { text: string }[];
        isError?: boolean;
      };
      expect(res.isError).toBeFalsy();
      expect(res.content[0]!.text).toBe("eco: 2");
      expect(conexiones).toBe(2);
    } finally {
      await close();
    }
  });

  it("a tool failure does not break the protocol: it comes back as isError", async () => {
    const up = new McpServer({ name: "roto", version: "0" });
    up.registerTool("boom", { description: "falla", inputSchema: {} }, async () => {
      throw new Error("the provider returned 429");
    });
    const { client, close } = await harness(() => linkedUpstream(up));
    try {
      const res = (await client.callTool({ name: "boom", arguments: {} })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("429");
    } finally {
      await close();
    }
  });
});

describe("isAuthError", () => {
  it("recognises the 401 whether it arrives as a code or as text", () => {
    expect(isAuthError({ code: 401 })).toBe(true);
    expect(isAuthError(new Error("HTTP 401 Unauthorized"))).toBe(true);
    expect(isAuthError(new Error("not authenticated"))).toBe(true);
    expect(isAuthError(new Error("connection closed"))).toBe(false);
  });
});
