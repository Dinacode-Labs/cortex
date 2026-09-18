import { loadEnv } from "@cortex/shared";
import { closeSql } from "./client.js";
import { runMigrations } from "./migrate.js";

/** Entrypoint of the migration runner (`pnpm db:migrate`). The only thing with side effects. */
loadEnv();
runMigrations()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
