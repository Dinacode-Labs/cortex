import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql, getSql } from "@cortex/database";
import { createProject, saveContext, updateProject, type ProjectRef } from "@cortex/core";
import { lexicalMatches } from "../../packages/core/src/storage/vectors.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `fts-owner-${RID}@example.com`;
const actor = { email: OWNER };
const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: true } as const;

let english: ProjectRef;
let spanish: ProjectRef;

beforeAll(async () => {
  english = await createProject(`IT FTS English ${RID}`, { ownerEmail: OWNER });
  spanish = await createProject(`IT FTS Spanish ${RID}`, { ownerEmail: OWNER });
  await updateProject(english.slug!, { language: "en" }, actor);
  await updateProject(spanish.slug!, { language: "es" }, actor);
}, 120_000);

afterAll(async () => {
  await closeSql();
});

const save = async (project: ProjectRef, content: string): Promise<string> =>
  (await saveContext({ project: project.name, content: `${content} ${RID}` }, opts)).entry.id;

const stored = async (id: string): Promise<{ language: string; tsv: string }> =>
  ((await getSql()`SELECT language, content_tsv::text AS tsv FROM memos WHERE id = ${id}`) as unknown as {
    language: string;
    tsv: string;
  }[])[0]!;

const found = async (project: ProjectRef, query: string): Promise<string[]> => {
  const sql = getSql();
  return (await lexicalMatches(sql, query, sql`AND m.project_id = ${project.id}`, 10)).map((m) => m.id);
};

/**
 * Full-text search stemmed everything as Spanish (ADR-0020). An English memo kept "the" as a
 * word and never met its own inflections: "workers restarting" did not find "the workers
 * restarted". Each memo is now indexed in its project's language, and the query, whose
 * language nobody knows, is stemmed both ways (ADR-0082).
 */
describe("each memo is searched in the language it was written in", () => {
  it("a memo takes its project's language when it is saved, and keeps it when the project changes", async () => {
    const id = await save(english, "The export workers restarted twice during the night.");
    expect((await stored(id)).language).toBe("en");

    await updateProject(english.slug!, { language: "es" }, actor);
    try {
      expect((await stored(id)).language).toBe("en");
    } finally {
      await updateProject(english.slug!, { language: "en" }, actor);
    }
  });

  it("an English memo is stemmed as English, a Spanish one as Spanish", async () => {
    // Spanish on purpose: the second memo is the corpus side of the comparison.
    const en = await stored(await save(english, "The export workers restarted twice during the night."));
    const es = await stored(await save(spanish, "El worker de exportación se reinició dos veces durante la noche."));

    expect({
      englishDropsItsStopwords: !en.tsv.includes("'the'"),
      englishStems: en.tsv.includes("'restart'") && en.tsv.includes("'worker'"),
      spanishDropsItsStopwords: !es.tsv.includes("'el'"),
      spanishStems: es.tsv.includes("'export'") && es.tsv.includes("'noch'"),
    }).toEqual({ englishDropsItsStopwords: true, englishStems: true, spanishDropsItsStopwords: true, spanishStems: true });
  });

  it("an English inflection finds the English memo, and a Spanish query still finds the Spanish one", async () => {
    const en = await save(english, "The billing workers restarted after the deploy.");
    // Spanish on purpose: the query has to reach the memo through Spanish stemming.
    const es = await save(spanish, "Las exportaciones de facturación fallan de noche.");

    expect(await found(english, "billing worker restarting")).toContain(en);
    expect(await found(spanish, "exportaciones de noche")).toContain(es);
  });
});
