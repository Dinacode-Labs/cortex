import { execSync } from "node:child_process";

/**
 * Prepara la BD de test: la crea en el contenedor Postgres de dev (si falta) y aplica
 * las migraciones. Falla con un mensaje claro si no hay Postgres (`pnpm db:up`).
 */
const TEST_DB = process.env.CORTEX_TEST_DATABASE_URL || "postgres://cortex:cortex@localhost:5433/cortex_test";
const CONTAINER = process.env.CORTEX_PG_CONTAINER || "cortex-postgres";

export default function setup(): void {
  const dbName = TEST_DB.split("/").pop()!.split("?")[0];
  try {
    execSync(
      `docker exec ${CONTAINER} psql -U cortex -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" | grep -q 1 || docker exec ${CONTAINER} psql -U cortex -d postgres -c "CREATE DATABASE ${dbName}"`,
      { stdio: "pipe" },
    );
  } catch (e) {
    throw new Error(`No se pudo preparar la BD de test "${dbName}". ¿Está Postgres arriba? (pnpm db:up). Detalle: ${(e as Error).message}`);
  }
  execSync("pnpm --filter @cortex/database run migrate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_DB } });
}
