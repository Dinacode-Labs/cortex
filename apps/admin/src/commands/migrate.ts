import { runMigrations } from "@cortex/database";

/** Aplica las migraciones pendientes. Mismo runner que `packages/database`, expuesto aquí
 *  para que operar el despliegue sea un solo binario. */
export async function run(): Promise<void> {
  await runMigrations();
}
