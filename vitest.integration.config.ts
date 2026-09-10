import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const cortexAlias = Object.fromEntries(
  ["shared", "client", "database", "embeddings", "core", "agents"].map((p) => [`@cortex/${p}`, join(root, "packages", p, "src/index.ts")]),
);

/**
 * Tests de INTEGRACIÓN: contra una BD Postgres real (cortex_test), con embeddings `local`
 * y LLM `none` (herméticos, sin red). Requiere el Postgres de dev (`pnpm db:up`); el
 * globalSetup crea+migra la BD de test. Ejecútalos con `pnpm test:integration`.
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
    fileParallelism: false, // comparten una BD; secuencial para evitar carreras
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
