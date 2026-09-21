/**
 * The marking of a retrieval run: how much of the evidence came back, and how far down.
 *
 * It lives apart from the command and takes no database, no embeddings and no filesystem: that
 * is what allows the rule deciding whether a question was answered to be tested on its own
 * (`tests/eval-retrieval-score.test.ts`). Running the eval needs a corpus loaded into Postgres
 * and a real provider, so a marker that is wrong in there is wrong in silence: every number
 * moves a little and the blame lands on the chunking, the rerank or the embeddings, which is
 * the one thing this eval exists to tell apart.
 */

/** An entry of the corpus, as the set stores it. The ids are the set's own, not the database's. */
export interface CorpusEntry {
  id: string;
  type: string;
  title: string;
  content: string;
}

export interface EvalQuestion {
  id: string;
  kind: string;
  question: string;
  /** The corpus ids that answer it. Empty = the answer is not there: nothing good should come out. */
  evidence: string[];
}

/** One result in the position the search returned it. Structural: this module imports no `core`. */
export interface RetrievedEntry {
  id: string;
  title: string;
  type: string;
  score: number;
}

export interface ScoreOptions {
  /** How many results are looked at. Past it nothing is retrieved, however much came back. */
  k: number;
  /**
   * Maps a corpus id to the id the entry was stored under. Identity against a real project,
   * where the evidence is already annotated with the database's own ids.
   */
  entryId?: (evidenceId: string) => string;
}

export interface QuestionScore {
  question: EvalQuestion;
  /** Position (1..k) of the first correct piece of evidence, or 0 when none appears. */
  firstHit: number;
  found: number;
  expected: number;
  /** For the unanswerable questions: what the best thing that came out scored. */
  bestScore: number;
  /** What came out, so a failure can be examined without rebuilding the corpus. */
  returned: { title: string; kind: string; score: number; hit: boolean }[];
}

export interface KindScore {
  kind: string;
  questions: number;
  recall: number;
  mrr: number;
}

export interface RetrievalSummary {
  answerable: number;
  unanswerable: number;
  recall: number;
  mrr: number;
  byKind: KindScore[];
}

export function scoreQuestion(question: EvalQuestion, retrieved: RetrievedEntry[], opts: ScoreOptions): QuestionScore {
  const { k, entryId = (id: string): string => id } = opts;
  // Cut here as well as in the search: a provider that returns more than it was asked for would
  // otherwise move recall@5 without anybody touching anything the eval is meant to measure.
  const hits = retrieved.slice(0, k);
  const expected = new Set(question.evidence.map(entryId));

  let firstHit = 0;
  let found = 0;
  hits.forEach((h, i) => {
    if (!expected.has(h.id)) return;
    found++;
    if (firstHit === 0) firstHit = i + 1;
  });

  return {
    question,
    firstHit,
    found,
    expected: expected.size,
    bestScore: hits[0]?.score ?? 0,
    returned: hits.map((h) => ({ title: h.title, kind: h.type, score: h.score, hit: expected.has(h.id) })),
  };
}

const recallOf = (scores: QuestionScore[]): number =>
  scores.reduce((s, r) => s + r.found / r.expected, 0) / (scores.length || 1);

const mrrOf = (scores: QuestionScore[]): number =>
  scores.reduce((s, r) => s + (r.firstHit ? 1 / r.firstHit : 0), 0) / (scores.length || 1);

/**
 * recall@k with several pieces of evidence: getting ONE of three is not getting the question
 * right, so the fraction retrieved of each is measured and averaged. Both numbers cover the
 * answerable questions only: for the ones the corpus does not answer there is no fraction to
 * retrieve and no correct position to measure, and counting them as zero would mark the memory
 * down for not inventing what it does not know.
 */
export function summarizeRetrieval(scores: QuestionScore[]): RetrievalSummary {
  const answerable = scores.filter((s) => s.expected > 0);
  const byKind = new Map<string, QuestionScore[]>();
  for (const s of answerable) byKind.set(s.question.kind, [...(byKind.get(s.question.kind) ?? []), s]);

  return {
    answerable: answerable.length,
    unanswerable: scores.length - answerable.length,
    recall: recallOf(answerable),
    mrr: mrrOf(answerable),
    byKind: [...byKind]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([kind, ss]) => ({ kind, questions: ss.length, recall: recallOf(ss), mrr: mrrOf(ss) })),
  };
}
