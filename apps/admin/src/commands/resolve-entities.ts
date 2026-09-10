import { resolveEntities } from "@cortex/core";

/** Fusiona variantes de una misma entidad en una canónica (solo BD, sin LLM). */
export async function run(): Promise<void> {
  const r = await resolveEntities();
  console.log(`Resolución de entidades: ${r.groups} grupos, ${r.merged} variantes fusionadas.`);
}
