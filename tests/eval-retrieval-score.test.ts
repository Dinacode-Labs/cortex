import { describe, it, expect } from "vitest";
import {
  scoreQuestion,
  summarizeRetrieval,
  type EvalQuestion,
  type RetrievedEntry,
} from "../apps/admin/src/eval/retrieval-score.js";

/**
 * The rule that decides whether a question was answered, exercised with no database.
 *
 * `eval` needs the corpus loaded into Postgres and a real embedding provider, so the part that
 * can be wrong in silence -- the marking -- is measured here instead: a marker that counts one
 * piece of evidence out of three as a hit turns any change into an improvement, and one that
 * averages in the questions the corpus does not answer marks the memory down for not inventing
 * what it does not know. Either way the numbers stop meaning anything and nobody notices,
 * because the only thing that is ever read is the total.
 */
const question = (evidence: string[], kind = "directa"): EvalQuestion => ({
  id: `q-${evidence.join("-") || "none"}`,
  kind,
  question: "the text is never marked: the evidence is matched by id",
  evidence,
});

/** Results in the order the search returned them, the score falling with the position. */
const returned = (...ids: string[]): RetrievedEntry[] =>
  ids.map((id, i) => ({ id, title: `entry ${id}`, type: "decision", score: 1 - i / 100 }));

describe("scoreQuestion", () => {
  /**
   * A question answered by three entries is answered by the three: retrieving one of them
   * leaves whoever reads the memory with a third of the picture and no way of telling. Scored
   * as a hit, the spread-out questions -- the ones chunking actually breaks -- would be the
   * ones reporting the best numbers.
   */
  it("retrieving one of three pieces of evidence is a third, not a hit", () => {
    const partial = scoreQuestion(question(["e1", "e2", "e3"]), returned("e1", "x", "y"), { k: 5 });
    expect(partial.found).toBe(1);
    expect(partial.expected).toBe(3);
    expect(summarizeRetrieval([partial]).recall).toBeCloseTo(1 / 3, 6);

    const whole = scoreQuestion(question(["e1", "e2", "e3"]), returned("e1", "e3", "e2"), { k: 5 });
    expect(whole.found).toBe(3);
    expect(summarizeRetrieval([whole]).recall).toBe(1);
  });

  /**
   * MRR answers a different question from recall: whether the good stuff comes out on top or
   * you have to scroll. What it reads is the position of the FIRST piece of evidence, and
   * nothing else -- an agent reading the pack takes what is at the top.
   */
  it("MRR follows the position of the first evidence, not how much came back", () => {
    const second = scoreQuestion(question(["e1"]), returned("x", "e1", "y"), { k: 5 });
    expect(second.firstHit).toBe(2);
    expect(summarizeRetrieval([second]).mrr).toBeCloseTo(0.5, 6);

    const onTop = scoreQuestion(question(["e1", "e2"]), returned("e1", "x", "e2"), { k: 5 });
    expect(onTop.firstHit).toBe(1);
    expect(summarizeRetrieval([onTop]).mrr).toBe(1);

    const nowhere = scoreQuestion(question(["e1"]), returned("x", "y"), { k: 5 });
    expect(nowhere.firstHit).toBe(0);
    expect(summarizeRetrieval([nowhere]).mrr).toBe(0);
  });

  /**
   * The evidence is annotated with the set's own ids and the corpus is loaded into a throwaway
   * project, which hands out ids of its own. Marking against the corpus ids would score every
   * question zero, and against a real project -- where the evidence already carries the
   * database's ids -- the mapping has to stay out of the way.
   */
  it("the evidence is matched against the id the entry was stored under", () => {
    const stored = new Map([["e1", "018f-real"]]);
    const mapped = scoreQuestion(question(["e1"]), returned("018f-real"), {
      k: 5,
      entryId: (id) => stored.get(id) ?? id,
    });
    expect(mapped.found).toBe(1);
    expect(scoreQuestion(question(["018f-real"]), returned("018f-real"), { k: 5 }).found).toBe(1);
  });

  /**
   * recall@5 is a promise about the first five results. A provider that returns more than the
   * limit it was given -- or a rerank that pads the list -- would otherwise move the number
   * without anybody touching the search, which is the one thing this eval exists to measure.
   */
  it("nothing past k counts, however much came back", () => {
    const ten = returned("a", "b", "c", "d", "e", "f", "e1", "g", "h", "i");
    const atFive = scoreQuestion(question(["e1"]), ten, { k: 5 });
    expect(atFive.found).toBe(0);
    expect(atFive.firstHit).toBe(0);
    expect(atFive.returned).toHaveLength(5);

    const atTen = scoreQuestion(question(["e1"]), ten, { k: 10 });
    expect(atTen.found).toBe(1);
    expect(atTen.firstHit).toBe(7);
  });
});

describe("summarizeRetrieval", () => {
  /**
   * Half the point of the set is the questions the corpus does NOT answer: what matters there
   * is what the best result scored, not a fraction that does not exist. Averaged in as a zero
   * they would drag both numbers down for ever; averaged in as a hit they would reward a memory
   * for answering what it cannot know.
   */
  it("the questions with no answer in the corpus stay out of both averages", () => {
    const answered = scoreQuestion(question(["e1"]), returned("e1"), { k: 5 });
    const absent = scoreQuestion(question([], "ausente"), returned("x", "y"), { k: 5 });
    const summary = summarizeRetrieval([answered, absent]);

    expect(summary.answerable).toBe(1);
    expect(summary.unanswerable).toBe(1);
    expect(summary.recall).toBe(1);
    expect(summary.mrr).toBe(1);
    expect(summary.byKind.map((k) => k.kind)).toEqual(["directa"]);
    // What is kept of them instead: how believable the best wrong answer looked.
    expect(absent.bestScore).toBe(1);
  });

  /**
   * The kinds are read apart because that is what tells one cause from another: a drop only in
   * the paraphrased ones points at the embeddings, only in the spread-out ones at the chunking.
   * One total would hide both.
   */
  it("each kind is averaged on its own, and the total over every answerable question", () => {
    const scores = [
      scoreQuestion(question(["e1"], "directa"), returned("e1"), { k: 5 }),
      scoreQuestion(question(["e2"], "multiple"), returned("x", "e2"), { k: 5 }),
      scoreQuestion(question(["e3"], "multiple"), returned("x", "y"), { k: 5 }),
    ];
    const summary = summarizeRetrieval(scores);

    expect(summary.byKind).toEqual([
      { kind: "directa", questions: 1, recall: 1, mrr: 1 },
      { kind: "multiple", questions: 2, recall: 0.5, mrr: 0.25 },
    ]);
    expect(summary.recall).toBeCloseTo(2 / 3, 6);
    expect(summary.mrr).toBeCloseTo(0.5, 6);
  });
});
