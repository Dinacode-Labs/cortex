import { applyTemporalInvalidation } from "@cortex/core";

export async function run(): Promise<void> {
  const r = await applyTemporalInvalidation();
  console.log(`Temporal invalidation: ${r.historical} marked historical, ${r.superseded} superseded.`);
}
