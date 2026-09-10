import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSql } from "./client.js";

/**
 * Runner de migraciones mínimo: aplica en orden los ficheros .sql de `migrations/` que aún
 * no estén registrados en `schema_migrations`. Cada migración corre en su propia
 * transacción.
 *
 * Es una LIBRERÍA (no se auto-ejecuta al importarse): el entrypoint es `migrate-cli.ts`.
 * Así el servidor o los tests pueden migrar sin arrastrar un `process.exit`.
 */

export interface MigrateOptions {
  /** Directorio de las migraciones. Por defecto, el hermano `migrations/` del compilado.
   *  Funciona igual desde `src/` y desde `dist/` porque ambos cuelgan de la raíz del
   *  paquete y `migrations/` está al mismo nivel. */
  migrationsDir?: string;
  log?: (line: string) => void;
}

export interface MigrateResult {
  applied: string[];
}

export async function runMigrations(opts: MigrateOptions = {}): Promise<MigrateResult> {
  const sql = getSql();
  const migrationsDir = opts.migrationsDir ?? resolve(import.meta.dirname, "../migrations");
  const log = opts.log ?? ((line: string) => console.log(line));

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const already = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (already.has(file)) continue;
    const contents = readFileSync(resolve(migrationsDir, file), "utf8");
    log(`→ aplicando ${file} ...`);
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    applied.push(file);
  }

  log(applied.length === 0 ? "Sin migraciones pendientes. Esquema al día." : `Aplicadas ${applied.length} migración(es).`);
  return { applied };
}
