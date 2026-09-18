import { resolveEntities } from "@cortex/core";

/** Merges variants of the same entity into a canonical one (database only, no LLM). */
export async function run(): Promise<void> {
  const r = await resolveEntities();
  console.log(`Entity resolution: ${r.groups} groups, ${r.merged} variants merged.`);
}
