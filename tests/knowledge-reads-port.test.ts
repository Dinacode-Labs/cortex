import { describe, it, expect, afterEach } from "vitest";
import { configureCore, getProjectGraph, lintProject, resetCore } from "../packages/core/src/index";
import {
  DUPLICATE_DISTANCE,
  GAP_MIN_INCIDENTS,
  type HealthReader,
  type HealthSnapshots,
} from "../packages/core/src/knowledge/domain/health";
import type { MemoReader } from "../packages/core/src/knowledge/domain/memo-reader";
import type { ProjectRepository } from "../packages/core/src/projects/domain/project-repository";

const oneProject = { findIdByRef: async () => "p1" } as unknown as ProjectRepository;
const forgetfulSnapshots = { record: async () => {}, latest: async () => new Map() } as unknown as HealthSnapshots;

function healthFinding(found: { contradictions: number; duplicates: number }): HealthReader {
  const pair = { a: "a", b: "b", aId: "m1", bId: "m2", score: 0.9 };
  return {
    currentCount: async () => 0,
    contradictions: async () => Array.from({ length: found.contradictions }, () => pair),
    likelyDuplicates: async () => Array.from({ length: found.duplicates }, () => pair),
    orphanEntities: async () => [],
    lowConfidenceCount: async () => 0,
    historicalCount: async () => 0,
    neverReviewedCount: async () => 0,
    incidentGaps: async () => [],
  } as unknown as HealthReader;
}

/**
 * The graph and the lint mixed their rules with their SQL, so the rules were only reachable
 * through a database; now they run on fakes (ADR-0085).
 */
describe("the knowledge reads, with no database", () => {
  afterEach(() => resetCore());

  it("the graph keeps only the edges whose two ends are nodes, and shortens long titles", async () => {
    const reader = {
      graphData: async () => ({
        entities: [{ id: "e1", name: "Stripe", type: "vendor" }],
        entries: [{ id: "m1", title: "x".repeat(60), type: "decision" }],
        relations: [
          { sourceId: "m1", targetId: "e1", relationType: "affects" },
          { sourceId: "m1", targetId: "elsewhere", relationType: "affects" },
        ],
        mentions: [{ memoId: "m1", entityId: "e1" }],
      }),
    } as unknown as MemoReader;
    configureCore({ projects: oneProject, memoReader: reader });

    const graph = await getProjectGraph("any");
    expect(graph.edges.map((e) => `${e.from}->${e.to}:${e.kind}`)).toEqual(["m1->e1:relation", "m1->e1:mention"]);
    expect(graph.nodes.find((n) => n.id === "m1")?.label).toBe(`${"x".repeat(45)}…`);
  });

  it("the lint asks the adapter with the thresholds the domain sets", async () => {
    const asked: unknown[] = [];
    const health = {
      currentCount: async () => 0,
      contradictions: async () => [],
      likelyDuplicates: async (_p: string, distance: unknown) => (asked.push(distance), []),
      orphanEntities: async () => [],
      lowConfidenceCount: async () => 0,
      historicalCount: async () => 0,
      neverReviewedCount: async () => 0,
      incidentGaps: async (_p: string, minIncidents: unknown) => (asked.push(minIncidents), []),
    } as unknown as HealthReader;
    configureCore({ projects: oneProject, health, healthSnapshots: forgetfulSnapshots });

    await lintProject("any");
    expect(asked).toEqual([DUPLICATE_DISTANCE, GAP_MIN_INCIDENTS]);
  });

  /**
   * The project cards read what the last lint found instead of linting: the projects page used to
   * lint every project on every view, and a lint of a large project takes seconds (ADR-0089). A
   * lint that stops recording leaves every card stuck on its last answer, or on "not checked yet".
   */
  it("every lint leaves what it found for the project cards", async () => {
    const recorded: unknown[] = [];
    const snapshots = {
      record: async (projectId: string, found: unknown) => void recorded.push({ projectId, found }),
      latest: async () => new Map(),
    } as unknown as HealthSnapshots;
    configureCore({
      projects: oneProject,
      health: healthFinding({ contradictions: 2, duplicates: 3 }),
      healthSnapshots: snapshots,
    });

    await lintProject("any");
    expect(recorded).toEqual([{ projectId: "p1", found: { contradictions: 2, duplicates: 3 } }]);
  });
});
