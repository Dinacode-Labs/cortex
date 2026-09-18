import { applyTemporalInvalidation } from "@cortex/core";

/** Closes the validity window of facts that are no longer current (historical/superseded). */
export async function run(): Promise<void> {
  const r = await applyTemporalInvalidation();
  console.log(`Temporal invalidation: ${r.historical} marked historical, ${r.superseded} superseded.`);
}
