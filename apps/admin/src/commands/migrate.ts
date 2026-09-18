import { runMigrations } from "@cortex/database";

/** Applies the pending migrations. The same runner as `packages/database`, exposed here so
 *  that operating the deployment means a single binary. */
export async function run(): Promise<void> {
  await runMigrations();
}
