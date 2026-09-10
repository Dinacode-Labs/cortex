import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { createMcpProxy, isAuthError } from "../apps/cli/src/mcp/proxy.js";

/**
 * El proxy es el único MCP que verán los agentes tras ADR-0025, así que lo que hay que
 * garantizar no es solo que reenvía: es que **el agente arranca igual** cuando el servidor
 * no responde o el token ha caducado. Un MCP que falla al inicializarse deja al agente sin
 * la sesión entera, y eso es peor que quedarse sin memoria.
 *
 * Todo corre en memoria: un `McpServer` de verdad hace de servidor remoto y el proxy le
 * habla por un par de transportes enlazados, sin red ni Postgres.
 */

/** Servidor "remoto" de mentira con una tool `echo`. */
function upstreamServer(): McpServer {
  const server = new McpServer({ name: "cortex-upstream", version: "0.0.0" });
  server.registerTool(
    "echo",
    { title: "Echo", description: "Devuelve lo que le mandes", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text" as const, text: `eco: ${text}` }] }),
  );
  return server;
}

/** Levanta proxy + cliente de prueba. `connect` cuenta las conexiones al upstream. */
async function harness(connect: () => Promise<Transport>) {
  const { server, close } = createMcpProxy({ connect, log: () => {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(a);
  return { client, close: async () => { await client.close(); await close(); } };
}

/** Un transporte enlazado a un `McpServer` recién arrancado. */
async function linkedUpstream(server: McpServer): Promise<Transport> {
  const [toServer, toClient] = InMemoryTransport.createLinkedPair();
  await server.connect(toServer);
  return toClient;
}

describe("createMcpProxy", () => {
  it("reenvía la lista de tools con su inputSchema", async () => {
    const up = upstreamServer();
    const { client, close } = await harness(() => linkedUpstream(up));
    try {
      const { tools } = await client.listTools();
      const echo = tools.find((t) => t.name === "echo");
      expect(echo).toBeDefined();
      // El JSON Schema viaja tal cual: el proxy no reconstruye nada con zod.
      expect(echo!.inputSchema.properties).toHaveProperty("text");
    } finally {
      await close();
    }
  });

  it("reenvía la llamada y devuelve el resultado del servidor", async () => {
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

  it("sin sesión el agente ARRANCA: listTools vacío y callTool con aviso de login", async () => {
    const connect = async (): Promise<Transport> => {
      throw Object.assign(new Error("no autenticado"), { code: 401 });
    };
    const { client, close } = await harness(connect);
    try {
      // Lo importante: `listTools` no lanza, o el agente no llegaría a arrancar.
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

  it("si el servidor cierra la conexión, reconecta una vez y la llamada funciona", async () => {
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

      // Simula el corte: reinicio del servidor, proxy inverso que cierra el stream…
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

  it("un fallo de tool no rompe el protocolo: vuelve como isError", async () => {
    const up = new McpServer({ name: "roto", version: "0" });
    up.registerTool("boom", { description: "falla", inputSchema: {} }, async () => {
      throw new Error("el proveedor devolvió 429");
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
  it("reconoce el 401 venga como código o como texto", () => {
    expect(isAuthError({ code: 401 })).toBe(true);
    expect(isAuthError(new Error("HTTP 401 Unauthorized"))).toBe(true);
    expect(isAuthError(new Error("no autenticado"))).toBe(true);
    expect(isAuthError(new Error("connection closed"))).toBe(false);
  });
});
