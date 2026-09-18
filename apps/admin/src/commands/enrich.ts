import { enrichProject, shutdownObservability, wireLlm } from "@cortex/agents";

/**
 * CLI for a project's graph enrichment pass (sections 7 and 12.4).
 * Usage: cortex-admin enrich "<Project>" [limit]
 * Env: CORTEX_ENRICH_ONLY_MISSING=1 to skip the ones already enriched.
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
    console.error('Usage: cortex-admin enrich "<Project>" [limit]');
    process.exitCode = 1;
    return;
  }
  const onlyMissing = process.env.CORTEX_ENRICH_ONLY_MISSING === "1";
  console.log(`Enriching "${project}"${onlyMissing ? " (only-missing)" : ""}...`);
  const r = await enrichProject(project, {
    onlyMissing,
    limit,
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) console.log(`  ${done}/${total}`);
    },
  });
  console.log(
    `Enrichment finished: +${r.entities} entity links, +${r.relations} relations, ${r.failed} failed${r.skipped ? `, ${r.skipped} already enriched` : ""}.`,
  );
}


