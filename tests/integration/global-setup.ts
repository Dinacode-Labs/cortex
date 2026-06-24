import { execSync } from "node:child_process";

/**
 * Prepara la BD de test: la crea en el contenedor Postgres de dev (si falta) y aplica
 * las migraciones. Falla con un mensaje claro si no hay Postgres (`pnpm db:up`).
 */
const TEST_DB = process.env.CORTEX_TEST_DATABASE_URL || "postgres://cortex:cortex@localhost:5433/cortex_test";
const CONTAINER = process.env.CORTEX_PG_CONTAINER || "cortex-postgres";

export default function setup(): void {
  const dbName = TEST_DB.split("/").pop()!.split("?")[0];
  // Crea la BD en el contenedor de dev (best-effort). En CI la crea el service (POSTGRES_DB),
  // así que si esto falla lo ignoramos y dejamos que migrate confirme la conexión.
  try {
    execSync(
      `docker exec ${CONTAINER} psql -U cortex -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" | grep -q 1 || docker exec ${CONTAINER} psql -U cortex -d postgres -c "CREATE DATABASE ${dbName}"`,
      { stdio: "pipe" },
    );
  } catch {
    /* sin contenedor de dev (p.ej. CI): la BD ya existe */
  }
  // migrate confirma la conexión y aplica el esquema; si falla, falla el run (señal real).
  execSync("pnpm --filter @cortex/database run migrate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_DB } });
}
