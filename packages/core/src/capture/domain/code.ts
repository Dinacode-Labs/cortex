export interface CodeFile {
  absPath: string;
  relPath: string;
  language: string;
}

export interface CodeChunk {
  relPath: string;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface CodeHit {
  path: string;
  startLine: number;
  endLine: number;
  language: string | null;
  content: string;
  score: number;
}

const CHUNK_LINES = 60;
const OVERLAP = 10;
// Dense code must not exceed the embedding model's context with a single chunk.
const MAX_CHUNK_CHARS = 4000;

export function chunkText(file: CodeFile, text: string): CodeChunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: CodeChunk[] = [];
  const step = CHUNK_LINES - OVERLAP;
  for (let i = 0; i < lines.length; i += step) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    let body = slice.join("\n");
    if (body.trim().length < 10) continue;
    if (body.length > MAX_CHUNK_CHARS) body = body.slice(0, MAX_CHUNK_CHARS);
    const startLine = i + 1;
    const endLine = Math.min(i + CHUNK_LINES, lines.length);
    chunks.push({
      relPath: file.relPath,
      language: file.language,
      startLine,
      endLine,
      content: `// ${file.relPath} (lines ${startLine}-${endLine})\n${body}`,
    });
    if (i + CHUNK_LINES >= lines.length) break;
  }
  return chunks;
}

export interface SourceTree {
  files(root: string): CodeFile[];
  read(file: CodeFile): string | null;
}

export interface CodeIndex {
  /** The repository's previous chunks are dropped first: an index of a repo is replaced, never merged. */
  replace(
    projectId: string,
    repo: string,
    chunks: CodeChunk[],
    opts: { batchSize: number; onProgress?: (done: number, total: number) => void },
  ): Promise<void>;
  search(projectId: string, query: string, limit: number): Promise<CodeHit[]>;
}
