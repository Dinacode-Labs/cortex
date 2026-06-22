import { closeSql } from "@cortex/database";
import { applyTemporalInvalidation } from "./temporal.js";

/** CLI: cierra la ventana de validez de hechos no vigentes (histórico/superseded). */
async function main(): Promise<void> {
  const r = await applyTemporalInvalidation();
  console.log(
    `Invalidación temporal: ${r.historical} marcadas históricas, ${r.superseded} superadas.`,
  );
}

main()
  .catch((e) => {
    console.error("Error en invalidación temporal:", e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
