import { enrichProject, shutdownObservability, wireLlm } from "@cortex/agents";

/**
 * CLI del pase de enriquecimiento de grafo (§7/§12.4) de un proyecto.
 * Uso: cortex enrich "<Proyecto>" [limite]
 * Env: CORTEX_ENRICH_ONLY_MISSING=1 para saltar las ya enriquecidas.
 */
export async function run(args: string[]): Promise<void> {
  wireLlm();
  try {
    await enrich(args);
  } finally {
    await shutdownObservability();
  }
}

async function enrich(args: string[]): Promise<void> {
  const project = args[0];
  const limit = Number(args[1] ?? "0") || undefined;
  if (!project) {
    console.error('Uso: cortex enrich "<Proyecto>" [limite]');
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


