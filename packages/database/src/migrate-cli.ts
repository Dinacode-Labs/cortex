import { loadEnv } from "@cortex/shared";
import { closeSql } from "./client.js";
import { runMigrations } from "./migrate.js";

/** Entrypoint del runner de migraciones (`pnpm db:migrate`). Lo único con side effects. */
loadEnv();
runMigrations()
  .catch((err) => {
    console.error("Error en la migración:", err);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
