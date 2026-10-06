import { describe, it, expect, afterEach } from "vitest";
import { configureCore, resetCore, searchContext } from "../packages/core/src/index";
import type { MemoIndex, MemoSearchScope, SearchHit } from "../packages/core/src/knowledge/domain/memo-index";
import type { ProjectRepository } from "../packages/core/src/projects/domain/project-repository";

const hit = (id: string, type: string, score: number): SearchHit =>
  ({ entry: { id, type, title: id }, score }) as unknown as SearchHit;

const childOfAcme = {
  findIdByRef: async () => "portal",
  idsWithAncestors: async () => ["portal", "acme"],
} as unknown as ProjectRepository;

function indexAnswering(hits: SearchHit[]): { index: MemoIndex; scopes: MemoSearchScope[] } {
  const scopes: MemoSearchScope[] = [];
  const index = {
    hybrid: async (_query: string, scope: MemoSearchScope) => {
      scopes.push(scope);
      return hits;
    },
  } as unknown as MemoIndex;
  return { index, scopes };
}

/**
 * Search is a use case with rules of its own -- which projects a question reaches, which type it
 * nudges up -- and they used to be reachable only through pgvector. Now they run on a fake index.
 */
describe("searching the memory, with no database", () => {
  afterEach(() => resetCore());

  it("a search inside a child also reaches its client's knowledge", async () => {
    const { index, scopes } = indexAnswering([]);
    configureCore({ projects: childOfAcme, memoIndex: index });

    await searchContext({ query: "deploy windows", project: "portal" });
    expect(scopes).toEqual([{ projectId: null, projectIds: ["portal", "acme"], type: undefined }]);
  });

  it("a question that names a type nudges that type up without touching the score", async () => {
    const { index } = indexAnswering([hit("a", "decision", 0.8), hit("b", "technical_debt", 0.7)]);
    configureCore({ projects: childOfAcme, memoIndex: index });

    const hits = await searchContext({ query: "what technical debt is there?", project: "portal" });
    expect(hits.map((h) => [h.entry.id, h.score])).toEqual([["b", 0.7], ["a", 0.8]]);
  });
});
