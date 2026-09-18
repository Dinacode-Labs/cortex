import { resolve } from "node:path";
import { indexRepo, registerUsageSink } from "@cortex/core";

/** Indexes a local repo's code into a project. */
export async function run(args: string[]): Promise<void> {
  registerUsageSink();
  const project = args[0];
  const repoPath = args[1];
  const repoName = args[2];
  if (!project || !repoPath) {
    console.error('Usage: cortex-admin index-code "<Project>" <repo-path> [repo-name]');
    process.exitCode = 1;
    return;
  }
  console.log(`Indexing code from ${resolve(repoPath)} into "${project}"...`);
  const maxChunks = process.env.CORTEX_MAX_CHUNKS ? Number(process.env.CORTEX_MAX_CHUNKS) : undefined;
  const r = await indexRepo(project, resolve(repoPath), {
    repoName,
    maxChunks,
    onProgress: (done, total) => {
      if (done % 320 === 0 || done === total) console.log(`  ${done}/${total} chunks`);
    },
  });
  console.log(`Done: ${r.files} files → ${r.chunks} chunks indexed.`);
  if (r.skippedOverCap > 0) console.log(`⚠️ ${r.skippedOverCap} chunks skipped because of the cap (maxChunks).`);
}
