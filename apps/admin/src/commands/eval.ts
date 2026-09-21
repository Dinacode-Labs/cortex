import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, saveContext, searchContext, type ProjectRef } from "@cortex/core";
import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  scoreQuestion,
  summarizeRetrieval,
  type CorpusEntry,
  type EvalQuestion,
  type QuestionScore,
} from "../eval/retrieval-score.js";

/**
 * `cortex-admin eval` -- measures retrieval against a set of questions with annotated evidence.
 *
 * It exists to answer the only question that matters when touching chunking, the rerank or
 * the embeddings: **did it get better or worse?** Without this, every change is defended with
 * hand-picked examples, which is the same as not defending it.
 *
 * The corpus is fixed in the repo (`evals/retrieval/`) and is not taken from the real memory:
 * an eval exists to compare runs, and the real memory changes every day, so the same code
 * change would give different numbers depending on what was captured that week.
 *
 *   cortex-admin eval                  the fixed corpus in a temporary project (deleted on exit)
 *   cortex-admin eval --keep           keeps the project so it can be inspected
 *   cortex-admin eval --project "X"    against a real project, with your own questions
 *   cortex-admin eval --questions <f>  a different questions file
 *   cortex-admin eval --k 10           how many results are looked at (5 by default)
 */

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

const ROOT = new URL("../../../../", import.meta.url).pathname;
const SET_DIR = join(ROOT, "evals/retrieval");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Loads the corpus into a fresh project and returns the corpus-id -> entry-id map. */
async function loadCorpus(project: ProjectRef, corpus: CorpusEntry[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const e of corpus) {
    const { entry } = await saveContext(
      { content: e.content, project: project.name, title: e.title, type: e.type as never, confidence: "high" },
      { useClassifier: false, detectImprovements: false },
    );
    map.set(e.id, entry.id);
  }
  return map;
}

function table(rows: [string, string, string, string][]): string {
  const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((f) => f[i]!.length)));
  return rows
    .map((f, n) => {
      const line = f.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
      return n === 0 ? `${line}\n${widths.map((a) => "─".repeat(a)).join("  ")}` : line;
    })
    .join("\n");
}

export async function run(args: string[]): Promise<void> {
  const k = Number(flag(args, "k") ?? "5");
  const existingProject = flag(args, "project");
  const questions = readJson<EvalQuestion[]>(flag(args, "questions") ?? join(SET_DIR, "questions.json"));

  const provider = getEmbeddingProvider();
  if (provider.model.startsWith("local")) {
    console.warn(
      "⚠️  EMBEDDINGS_PROVIDER=local: this is a word hash, it does not understand that two\n" +
        "    different sentences say the same thing. The numbers below are no use for comparing\n" +
        "    anything; they are a floor. Configure a real provider to measure.\n",
    );
  }

  let project: ProjectRef;
  let map: Map<string, string>;
  if (existingProject) {
    const sql = getSql();
    const rows = (await sql`SELECT id, name, slug FROM entities WHERE type='project' AND name=${existingProject} LIMIT 1`) as unknown as {
      id: string;
      name: string;
      slug: string;
    }[];
    if (!rows[0]) {
      console.error(`Project "${existingProject}" does not exist.`);
      process.exitCode = 1;
      return;
    }
    project = rows[0] as ProjectRef;
    map = new Map(); // with a real project, the evidence already carries the real ids
  } else {
    const corpus = readJson<CorpusEntry[]>(join(SET_DIR, "corpus.json"));
    project = await createProject(`Eval ${Date.now().toString(36)}`);
    console.log(`Loading ${corpus.length} entries into "${project.name}"...`);
    map = await loadCorpus(project, corpus);
  }

  const realId = (id: string): string => map.get(id) ?? id;

  const results: QuestionScore[] = [];
  for (const p of questions) {
    const hits = await searchContext({ query: p.question, project: project.name, limit: k });
    const retrieved = hits.map((h) => ({
      id: h.entry.id,
      title: h.entry.title ?? "(untitled)",
      type: h.entry.type,
      score: h.score,
    }));
    results.push(scoreQuestion(p, retrieved, { k, entryId: realId }));
  }

  const summary = summarizeRetrieval(results);
  const rows: [string, string, string, string][] = [["kind", "n", "recall@" + k, "MRR"]];
  for (const { kind, questions: n, recall, mrr } of summary.byKind) {
    rows.push([kind, String(n), recall.toFixed(3), mrr.toFixed(3)]);
  }
  rows.push(["TOTAL", String(summary.answerable), summary.recall.toFixed(3), summary.mrr.toFixed(3)]);

  console.log(`\n# Retrieval eval — ${project.name}`);
  console.log(`_${questions.length} questions · embeddings: ${provider.model} (${provider.dim} dim)_\n`);
  console.log(table(rows));

  const missed = results.filter((r) => r.expected > 0 && r.found < r.expected);
  if (missed.length > 0) {
    console.log(`\n## Not fully retrieved (${missed.length})`);
    for (const r of missed) {
      const where = r.firstHit ? `first evidence at position ${r.firstHit}` : "no evidence in the results";
      console.log(`- [${r.question.kind}] ${r.question.question}\n  ${r.found}/${r.expected} · ${where}`);
      // With --verbose, what DID come out: without it, a failure says nothing about how to fix it.
      if (args.includes("--verbose")) {
        for (const [i, h] of r.returned.entries()) {
          console.log(`      ${h.hit ? "✓" : " "} ${i + 1}. (${h.score.toFixed(3)}) ${h.kind} · ${h.title}`);
        }
      }
    }
  }

  const unanswerable = results.filter((r) => r.expected === 0);
  if (unanswerable.length > 0) {
    console.log(`\n## Questions with no answer in the corpus (${unanswerable.length})`);
    console.log("_The memory does not know them. What the best result scores is shown: the higher it is, the easier it is for an agent to believe it._");
    for (const r of unanswerable) console.log(`- ${r.question.question} → best score ${r.bestScore.toFixed(3)}`);
  }

  if (!existingProject && !args.includes("--keep")) {
    await getSql()`DELETE FROM entities WHERE id = ${project.id}`;
    console.log(`\n_Temporary project deleted. Use --keep to keep it._`);
  } else if (!existingProject) {
    console.log(`\n_Project "${project.name}" kept._`);
  }
}
