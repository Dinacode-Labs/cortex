import { resolveEntities } from "@cortex/core";

export async function run(): Promise<void> {
  const r = await resolveEntities();
  console.log(`Entity resolution: ${r.groups} groups, ${r.merged} variants merged.`);
}
