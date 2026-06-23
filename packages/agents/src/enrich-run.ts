import { closeSql } from "@cortex/database";
import { enrichProject } from "./enrich-project.js";
import { shutdownObservability } from "./mastra.js";

/**
 * CLI del pase de enriquecimiento de grafo (§7/§12.4) de un proyecto.
 * Uso: tsx src/enrich-run.ts "<Proyecto>" [limite]
 * Env: CORTEX_ENRICH_ONLY_MISSING=1 para saltar las ya enriquecidas.
 */
async function main(): Promise<void> {
  const project = process.argv[2];
  const limit = Number(process.argv[3] ?? "0") || undefined;
  if (!project) {
    console.error('Uso: tsx src/enrich-run.ts "<Proyecto>" [limite]');
    process.exitCode = 1;
    return;
  }
  const onlyMissing = process.env.CORTEX_ENRICH_ONLY_MISSING === "1";
  console.log(`Enriqueciendo "${project}"${onlyMissing ? " (only-missing)" : ""}...`);
  const r = await enrichProject(project, {
    onlyMissing,
    limit,
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) console.log(`  ${done}/${total}`);
    },
  });
  console.log(
    `Enriquecimiento completado: +${r.entities} enlaces de entidad, +${r.relations} relaciones, ${r.failed} fallos${r.skipped ? `, ${r.skipped} ya enriquecidas` : ""}.`,
  );
}

main()
  .catch((e) => {
    console.error("Error en enriquecimiento:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownObservability();
    await closeSql();
    process.exit(process.exitCode ?? 0);
  });
