import { applyTemporalInvalidation } from "@cortex/core";

/** Cierra la ventana de validez de hechos no vigentes (histórico/superseded). */
export async function run(): Promise<void> {
  const r = await applyTemporalInvalidation();
  console.log(`Invalidación temporal: ${r.historical} marcadas históricas, ${r.superseded} superadas.`);
}
