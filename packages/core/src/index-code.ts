import { resolve } from "node:path";
import { closeSql } from "@cortex/database";
import { indexRepo } from "./code.js";
import { registerUsageSink } from "./usage.js";

/**
 * Indexa el código de un repo local en un proyecto.
 * Uso: tsx src/index-code.ts "<Proyecto>" <ruta-repo> [nombre-repo]
 */
async function main(): Promise<void> {
  registerUsageSink();
  const project = process.argv[2];
  const repoPath = process.argv[3];
  const repoName = process.argv[4];
  if (!project || !repoPath) {
    console.error('Uso: tsx src/index-code.ts "<Proyecto>" <ruta-repo> [nombre-repo]');
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

main()
  .catch((e) => {
    console.error("Error indexando código:", e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
