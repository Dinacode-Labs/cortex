import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSql } from "./client.js";

/**
 * Minimal migration runner: applies, in order, the .sql files in `migrations/` that are not
 * yet recorded in `schema_migrations`. Each migration runs in its own transaction.
 *
 * This is a LIBRARY (it does not run itself on import): the entrypoint is `migrate-cli.ts`.
 * That way the server or the tests can migrate without dragging in a `process.exit`.
 */

export interface MigrateOptions {
  /** Migrations directory. Defaults to the `migrations/` sibling of the compiled output.
   *  It works the same from `src/` and from `dist/` because both hang off the package root
   *  and `migrations/` sits at the same level. */
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
    log(`-> applying ${file} ...`);
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    applied.push(file);
  }

  log(applied.length === 0 ? "No pending migrations. Schema is up to date." : `Applied ${applied.length} migration(s).`);
  return { applied };
}
