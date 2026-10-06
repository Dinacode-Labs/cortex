import { basename } from "node:path";
import { port } from "../../composition.js";
import { findProjectIdByName } from "../../projects/application/projects.js";
import { chunkText, type CodeChunk, type CodeHit } from "../domain/code.js";

export type { CodeHit } from "../domain/code.js";

export async function searchProjectCode(query: string, project: string, limit = 8): Promise<CodeHit[]> {
  const projectId = await findProjectIdByName(project);
  if (!projectId) return [];
  return port("codeIndex").search(projectId, query, limit);
}

export function renderCodeHits(hits: CodeHit[]): string {
  if (hits.length === 0) return "No matching code found.";
  return hits
    .map(
      (h) =>
        `### ${h.path}:${h.startLine}-${h.endLine} (${(h.score).toFixed(2)})\n\`\`\`${h.language ?? ""}\n${stripHeader(h.content)}\n\`\`\``,
    )
    .join("\n\n");
}

function stripHeader(content: string): string {
  const nl = content.indexOf("\n");
  return nl > 0 && content.startsWith("// ") ? content.slice(nl + 1) : content;
}

export async function indexRepo(
  project: string,
  repoPath: string,
  opts: { repoName?: string; batchSize?: number; maxChunks?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ files: number; chunks: number; skippedOverCap: number }> {
  const projectId = await findProjectIdByName(project);
  if (!projectId) throw new Error(`Project not found: "${project}".`);
  const repoName = opts.repoName ?? basename(repoPath.replace(/\/$/, ""));
  const maxChunks = opts.maxChunks ?? 8000;

  const tree = port("sourceTree");
  const files = tree.files(repoPath);
  let all: CodeChunk[] = [];
  for (const f of files) {
    const text = tree.read(f);
    if (text !== null) all.push(...chunkText(f, text));
  }
  const skippedOverCap = Math.max(0, all.length - maxChunks);
  if (skippedOverCap > 0) all = all.slice(0, maxChunks);

  await port("codeIndex").replace(projectId, repoName, all, {
    batchSize: opts.batchSize ?? 32,
    onProgress: opts.onProgress,
  });
  return { files: files.length, chunks: all.length, skippedOverCap };
}
