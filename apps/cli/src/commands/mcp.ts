import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpProxy } from "../mcp/proxy.js";
import { httpTransport, resolveUpstream } from "../mcp/upstream.js";

/**
 * `cortex mcp` -- an MCP server over stdio that forwards to the server's HTTP MCP.
 *
 * It is what gets registered in each agent (`claude mcp add cortex -- cortex mcp`). The local
 * process never touches the database: it only carries messages back and forth, authenticated
 * with `cortex auth login`'s token, so the tools respect the user's permissions.
 *
 * NOTE: stdout is the protocol's channel. Any log goes to stderr or it breaks the session.
 */
export async function run(): Promise<void> {
  const { server, close } = createMcpProxy({
    connect: async () => {
      // `resolveUpstream` throws `NoSessionError` naming the concrete server and the sessions
      // that do exist: the proxy shows that as is rather than reducing it to "not signed in".
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
