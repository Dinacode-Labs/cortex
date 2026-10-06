import { describe, it, expect, afterEach } from "vitest";
import { configureCore, getProjectLanguage, resetCore } from "../packages/core/src/index";
import { port } from "../packages/core/src/composition";
import { PgMemoRepository } from "../packages/core/src/knowledge/infrastructure/memo.repository";
import type { ProjectRepository } from "../packages/core/src/projects/domain/project-repository";

process.env.DATABASE_URL ??= "postgres://nobody@127.0.0.1:1/never"; // the client connects on its first query, never here

const englishProjects = {
  findIdByRef: async () => "p1",
  settingsChain: async () => [{ language: "en", criteria: null }],
} as unknown as ProjectRepository;

/**
 * A use case that builds its own adapter can never run on another one (ADR-0085): swapping Postgres
 * would mean editing the use case. Here a use case runs on a fake, with no database at all.
 */
describe("the composition decides which adapter answers each port", () => {
  afterEach(() => resetCore());

  it("a use case runs on whatever adapter the composition is given", async () => {
    configureCore({ projects: englishProjects });

    expect(await getProjectLanguage("any")).toEqual({ own: "en", effective: "en" });
  });

  it("replacing one port leaves the others on their default adapter, and a reset brings it back", () => {
    configureCore({ projects: englishProjects });
    expect(port("projects")).toBe(englishProjects);
    expect(port("memos")).toBeInstanceOf(PgMemoRepository);

    resetCore();
    expect(port("projects")).not.toBe(englishProjects);
  });
});
