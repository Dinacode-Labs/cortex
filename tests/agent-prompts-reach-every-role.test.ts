import { describe, it, expect, vi } from "vitest";
import type { AgentRole } from "../packages/shared/src/index";
import type { SearchHit } from "../packages/core/src/index";
import { classifyEntry } from "../packages/agents/src/agents/classifier/classify";
import { extractGraph } from "../packages/agents/src/agents/graph/extract-graph";
import { rerankLLM } from "../packages/agents/src/agents/reranker/rerank";
import { synthesizeContextAnswer } from "../packages/agents/src/agents/retriever/synthesize";
import { distill } from "../packages/agents/src/agents/distiller/distill";
import { mergeKnowledge } from "../packages/agents/src/agents/merger/merge";
import { draftMerge } from "../packages/agents/src/agents/merger/draft";
import { reconcile } from "../packages/agents/src/agents/reconciler/reconcile";
import { judgeGroups } from "../packages/agents/src/agents/judge/judge";
import { suggestEdit } from "../packages/agents/src/agents/editor/edit";

const runAgent = vi.fn(async (..._args: unknown[]) => "{}");
vi.mock("../packages/agents/src/runtime/run-agent.js", () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock("../packages/agents/src/runtime/registry.js", () => ({ getAgent: () => ({}) }));

const hit = { score: 1, entry: { type: "decision", title: "Use ULIDs", summary: "Public ids are ULIDs." } } as unknown as SearchHit;
const PROJECT = "project-id";
const memo = { id: "memo-id", sourceType: "agent_session" as const, type: "decision" as const, title: "Use ULIDs", content: "Public ids are ULIDs.", createdAt: new Date("2026-10-01") };

const CALLS: Record<AgentRole, () => Promise<unknown>> = {
  classifier: () => classifyEntry("a memo", { language: "en", projectId: PROJECT }),
  graph: () => extractGraph("a memo", { language: "en", projectId: PROJECT }),
  reranker: () => rerankLLM("a question", [hit, hit], { projectId: PROJECT }),
  retriever: () => synthesizeContextAnswer("a question", [{ type: "decision", title: "T", summary: "S" }], { projectId: PROJECT }),
  distiller: () => distill("P", "a window", { projectId: PROJECT }),
  merger: () =>
    Promise.all([
      mergeKnowledge("an entry", "another", { language: "en", projectId: PROJECT }),
      draftMerge([memo, memo], { language: "en", projectId: PROJECT }),
    ]),
  reconciler: () => reconcile("an entry", "another", { projectId: PROJECT }),
  judge: () => judgeGroups(memo, [memo], { language: "en", projectId: PROJECT }),
  editor: () => suggestEdit(memo, { language: "en", projectId: PROJECT, criteria: { types: {}, keep: [], discard: [] } }),
};

/**
 * A role that forgets to pass its project still compiles — a function taking fewer parameters
 * fits the hook's type — and still answers, with root's criterion instead of the project's.
 * Nothing would look wrong; the project's prompt would simply never apply (ADR-0088).
 */
describe("the prompt a project sets reaches every role", () => {
  it("because every role hands runAgent the project it works for", async () => {
    const lost: string[] = [];
    for (const [role, call] of Object.entries(CALLS)) {
      runAgent.mockClear();
      await call();
      const calls = runAgent.mock.calls;
      const strays = calls.filter(([calledRole, , opts]) => calledRole !== role || (opts as { projectId?: string } | undefined)?.projectId !== PROJECT);
      if (calls.length === 0 || strays.length > 0) lost.push(role);
    }
    expect(lost).toEqual([]);
  });
});
