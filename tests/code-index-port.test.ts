import { describe, it, expect, afterEach } from "vitest";
import { configureCore, indexRepo, resetCore } from "../packages/core/src/index";
import type { CodeChunk, CodeFile, CodeIndex, SourceTree } from "../packages/core/src/capture/domain/code";
import type { ProjectRepository } from "../packages/core/src/projects/domain/project-repository";

const file = (relPath: string): CodeFile => ({ absPath: `/repo/${relPath}`, relPath, language: "typescript" });
const lines = (n: number): string => Array.from({ length: n }, (_, i) => `const line${i} = ${i};`).join("\n");

/**
 * Indexing a repository walked the disk, chunked and wrote embeddings in one function, so its
 * rules (how a file is cut, the cap, a file that cannot be read) needed a real repo and a database.
 */
describe("indexing a repository, with no disk and no database", () => {
  afterEach(() => resetCore());

  it("cuts each readable file, skips the unreadable ones, caps the total and replaces the repo's index", async () => {
    const tree = {
      files: () => [file("a.ts"), file("gone.ts"), file("b.ts")],
      read: (f: CodeFile) => (f.relPath === "gone.ts" ? null : lines(120)),
    } as SourceTree;
    const replaced: { repo: string; chunks: CodeChunk[] }[] = [];
    const index = {
      replace: async (_p: string, repo: string, chunks: CodeChunk[]) => void replaced.push({ repo, chunks }),
    } as unknown as CodeIndex;
    const projects = { findIdByRef: async () => "p1" } as unknown as ProjectRepository;
    configureCore({ projects, sourceTree: tree, codeIndex: index });

    const result = await indexRepo("any", "/repo/acme-api", { maxChunks: 4 });

    expect(result).toEqual({ files: 3, chunks: 4, skippedOverCap: 2 });
    expect(replaced.map((r) => [r.repo, r.chunks.map((c) => `${c.relPath}:${c.startLine}-${c.endLine}`)])).toEqual([
      ["acme-api", ["a.ts:1-60", "a.ts:51-110", "a.ts:101-120", "b.ts:1-60"]],
    ]);
  });
});
