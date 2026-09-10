import { resolve } from "node:path";
import { indexRepo, registerUsageSink } from "@cortex/core";

/** Indexa el código de un repo local en un proyecto. */
export async function run(args: string[]): Promise<void> {
  registerUsageSink();
  const project = args[0];
  const repoPath = args[1];
  const repoName = args[2];
  if (!project || !repoPath) {
    console.error('Uso: cortex index-code "<Proyecto>" <ruta-repo> [nombre-repo]');
    process.exitCode = 1;
    return;
  }
  console.log(`Indexando código de ${resolve(repoPath)} en "${project}"...`);
  const maxChunks = process.env.CORTEX_MAX_CHUNKS ? Number(process.env.CORTEX_MAX_CHUNKS) : undefined;
  const r = await indexRepo(project, resolve(repoPath), {
    repoName,
    maxChunks,
    onProgress: (done, total) => {
      if (done % 320 === 0 || done === total) console.log(`  ${done}/${total} chunks`);
    },
  });
  console.log(`Hecho: ${r.files} ficheros → ${r.chunks} chunks indexados.`);
  if (r.skippedOverCap > 0) console.log(`⚠️ ${r.skippedOverCap} chunks omitidos por el límite (maxChunks).`);
}
