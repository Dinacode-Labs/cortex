#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeSql } from "@cortex/database";
import { isLlmEnabled, loadEnv } from "@cortex/shared";
import { wireLlm } from "@cortex/agents";
import { buildMcpServer } from "./server.js";

/**
 * Cortex Knowledge MCP -- STDIO transport (local, per process). stdout is the protocol's
 * channel, so every log goes to stderr. The authenticated HTTP one lives in `http.ts`.
 */
async function main(): Promise<void> {
  loadEnv();
  wireLlm();
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[cortex-mcp] MCP server ready (stdio). LLM: ${isLlmEnabled() ? "on" : "off"}.`);
}

const shutdown = async () => {
  await closeSql().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  console.error("[cortex-mcp] failed to start:", e);
  process.exit(1);
});
