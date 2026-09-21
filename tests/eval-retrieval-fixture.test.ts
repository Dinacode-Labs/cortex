import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contextEntryType } from "@cortex/shared";
import type { CorpusEntry, EvalQuestion } from "../apps/admin/src/eval/retrieval-score.js";

/**
 * The retrieval set, checked without standing up a database or spending a call on a provider.
 *
 * Everything here is a rule that breaks in silence: `eval` loads the corpus into Postgres and
 * needs a real embedding provider, so evidence pointing at an id nobody wrote, a duplicated id
 * or a question labelled with a kind that is in no table does not come out as an error. It
 * comes out as a number slightly worse than the previous one, which reads exactly like the
 * chunking or the embeddings having got worse -- and telling those apart is the whole job of
 * this set.
 */
const SET = resolve(import.meta.dirname, "../evals/retrieval");

const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(SET, file), "utf8")) as T;
const corpus = read<CorpusEntry[]>("corpus.json");
const questions = read<EvalQuestion[]>("questions.json");

/**
 * The taxonomy of the questions, in Spanish because the questions are (they are data, not our
 * prose). Each one names how the question reaches its evidence, and the numbers are read one
 * kind at a time: that is what tells a drop in the embeddings from a drop in the chunking.
 * `ausente` is the odd one out -- the corpus does not answer it, and nothing good should come
 * out of it.
 */
const KINDS = ["directa", "parafraseada", "razonada", "multiple", "ausente"];
const UNANSWERABLE = "ausente";

const duplicates = (ids: string[]): string[] => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].sort();

describe("the retrieval fixture", () => {
  it("the set is there and it is not empty", () => {
    // A file that is not there throws on the way in; one that is there and empty does not.
    // An empty corpus leaves the run printing a full table in which nothing was ever found.
    expect(corpus.length).toBeGreaterThan(0);
    expect(questions.length).toBeGreaterThan(0);
  });

  /**
   * Evidence pointing at an id nobody wrote can never be retrieved. It is reported for ever as
   * a miss, and the miss is blamed on the search.
   */
  it("every piece of evidence cited exists in the corpus", () => {
    const ids = new Set(corpus.map((e) => e.id));
    const dangling: string[] = [];
    for (const q of questions) for (const e of q.evidence) if (!ids.has(e)) dangling.push(`${q.id} → ${e}`);
    expect(dangling).toEqual([]);
  });

  /**
   * A repeated corpus id makes the corpus-id → entry-id map keep the last one, so the evidence
   * of the first silently points at somebody else's text; a repeated question id makes two
   * questions indistinguishable in a failure list.
   */
  it("the ids are unique, in the corpus and in the questions", () => {
    expect(duplicates(corpus.map((e) => e.id))).toEqual([]);
    expect(duplicates(questions.map((q) => q.id))).toEqual([]);
  });

  /**
   * The kind is a column in the table, so a typo does not fail: it quietly opens a row of its
   * own with one question in it, and the kind it was meant to join loses a measurement.
   */
  it("every question carries a kind from the closed set", () => {
    const known = new Set(KINDS);
    const unknown = questions.filter((q) => !known.has(q.kind)).map((q) => `${q.id}: "${q.kind}"`);
    expect(unknown).toEqual([]);
  });

  /**
   * The corpus is loaded with `useClassifier: false`, so the type in the file is the type the
   * entry is stored with, and `saveContext` refuses any the domain does not know. The run then
   * dies on its first entry -- after a Postgres, a corpus load and a provider with keys in it.
   * This is that same failure, in milliseconds, and it also keeps the set in step with the
   * enum: a type renamed in `contextEntryType` leaves whatever cites it unsavable.
   */
  it("every corpus entry has a type the domain knows", () => {
    const types = new Set<string>(contextEntryType.options);
    const unknown = corpus.filter((e) => !types.has(e.type)).map((e) => `${e.id}: "${e.type}"`);
    expect(unknown).toEqual([]);
  });

  /**
   * These two halves are marked in opposite ways -- one by the evidence that came back, the
   * other by how believable the best wrong answer looked -- and nothing checks they agree.
   * Evidence added to an `ausente` moves it into the average; evidence dropped from an
   * answerable one moves it out of the average and into the list of what the memory does not
   * know, which is where a real regression would hide best.
   */
  it("the questions with no evidence are exactly the ones marked as unanswerable", () => {
    const disagreeing = questions
      .filter((q) => (q.kind === UNANSWERABLE) !== (q.evidence.length === 0))
      .map((q) => `${q.id} [${q.kind}]: ${q.evidence.length} pieces of evidence`);
    expect(disagreeing).toEqual([]);
    // Both halves exist: a set with no unanswerable question measures volume, not judgement.
    expect(questions.some((q) => q.kind === UNANSWERABLE)).toBe(true);
    expect(questions.some((q) => q.kind !== UNANSWERABLE)).toBe(true);
  });
});
