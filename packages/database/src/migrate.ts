import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { closeSql, getSql } from "./client.js";

/**
 * Runner de migraciones mínimo: aplica en orden los ficheros .sql de
 * `migrations/` que aún no estén registrados en `schema_migrations`.
 * Cada migración corre en su propia transacción.
 */
async function migrate(): Promise<void> {
  const sql = getSql();
  const migrationsDir = resolve(import.meta.dirname, "../migrations");

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const contents = readFileSync(resolve(migrationsDir, file), "utf8");
    process.stdout.write(`→ aplicando ${file} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    process.stdout.write("ok\n");
    count++;
  }

  if (count === 0) {
    console.log("Sin migraciones pendientes. Esquema al día.");
  } else {
    console.log(`Aplicadas ${count} migración(es).`);
  }
}

migrate()
  .catch((err) => {
    console.error("Error en la migración:", err);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
