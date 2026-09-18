import { defineConfig } from "tsup";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("./package.json") as { version: string };

/**
 * The CLI ships to npm as **a single file**: `@cortex/client` and `@cortex/shared` go inside
 * it (`noExternal`) because they are private monorepo packages and npm would not know how to
 * download them.
 *
 * What does stay outside is the MCP SDK, zod and yaml: the SDK does dynamic `require`s that a
 * flat bundle breaks, and all three are public packages npm installs without trouble.
 *
 * The version is injected at build time instead of reading package.json at runtime: after
 * bundling there is no package.json next to the file.
 */
export default defineConfig({
  entry: { cortex: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  splitting: false,
  clean: true,
  dts: false,
  sourcemap: false,
  noExternal: [/^@cortex\//],
  external: ["@modelcontextprotocol/sdk", "zod", "yaml"],
  define: { __CORTEX_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "#!/usr/bin/env node" },
});
