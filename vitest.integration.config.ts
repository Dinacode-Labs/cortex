import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const cortexAlias = Object.fromEntries(
  ["shared", "client", "database", "embeddings", "core", "agents"].map((p) => [`@cortex/${p}`, join(root, "packages", p, "src/index.ts")]),
);

/**
 * INTEGRATION tests: against a real Postgres database (cortex_test), with `local` embeddings
 * and LLM `none` (hermetic, no network). They need the dev Postgres (`pnpm db:up`); the
 * globalSetup creates and migrates the test database. Run them with `pnpm test:integration`.
 */
const TEST_DB = process.env.CORTEX_TEST_DATABASE_URL || "postgres://cortex:cortex@localhost:5433/cortex_test";

export default defineConfig({
  plugins: [
    {
      name: "nodenext-js-to-ts",
      enforce: "pre",
      async resolveId(source, importer, options) {
        if (importer && source.endsWith(".js") && (source.startsWith("./") || source.startsWith("../"))) {
          const r = await this.resolve(source.slice(0, -3) + ".ts", importer, { ...options, skipSelf: true });
          if (r) return r;
        }
        return null;
      },
    },
  ],
  resolve: { alias: cortexAlias },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false, // they share one database; sequential to avoid races
    testTimeout: 30_000,
    env: {
      DATABASE_URL: TEST_DB,
      EMBEDDINGS_PROVIDER: "local",
      LLM_PROVIDER: "none",
      CORTEX_AUTH_DOMAIN: "example.com",
      CORTEX_ADMIN_EMAIL: "admin@example.com",
    },
  },
});
