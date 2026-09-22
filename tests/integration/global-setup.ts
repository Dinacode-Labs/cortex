import { execSync } from "node:child_process";

const TEST_DB = process.env.CORTEX_TEST_DATABASE_URL || "postgres://cortex:cortex@localhost:5433/cortex_test";
const CONTAINER = process.env.CORTEX_PG_CONTAINER || "cortex-postgres";

export default function setup(): void {
  const dbName = TEST_DB.split("/").pop()!.split("?")[0];
  // Creates the database in the dev container (best-effort). In CI the service creates it
  // (POSTGRES_DB), so when this fails we ignore it and let migrate confirm the connection.
  try {
    execSync(
      `docker exec ${CONTAINER} psql -U cortex -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" | grep -q 1 || docker exec ${CONTAINER} psql -U cortex -d postgres -c "CREATE DATABASE ${dbName}"`,
      { stdio: "pipe" },
    );
  } catch {
    /* no dev container (CI, for instance): the database already exists */
  }
  // migrate confirms the connection and applies the schema; when it fails, the run fails (a real signal).
  execSync("pnpm --filter @cortex/database run migrate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_DB } });
}
