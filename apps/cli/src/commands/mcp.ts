import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpProxy } from "../mcp/proxy.js";
import { httpTransport, resolveUpstream } from "../mcp/upstream.js";

/**
 * `cortex mcp` — servidor MCP por stdio que reenvía al MCP HTTP del servidor.
 *
 * Es lo que se registra en cada agente (`claude mcp add cortex -- cortex mcp`). El proceso
 * local no toca la base de datos: solo lleva y trae, autenticado con el token de
 * `cortex auth login`, así que las tools respetan los permisos del usuario.
 *
 * OJO: stdout es el canal del protocolo. Cualquier log va a stderr o rompe la sesión.
 */
export async function run(): Promise<void> {
  const { server, close } = createMcpProxy({
    connect: async () => {
      // `resolveUpstream` lanza `SinSesionError` con el servidor concreto y las sesiones que
      // sí hay: el proxy lo enseña tal cual en vez de traducirlo a «no has iniciado sesión».
      const target = await resolveUpstream();
      if (!target) throw Object.assign(new Error("no autenticado"), { code: 401 });
      return httpTransport(target);
    },
  });

  await server.connect(new StdioServerTransport());
  console.error("[cortex mcp] stdio ↔ server proxy ready.");

  const shutdown = (): void => {
    void close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
