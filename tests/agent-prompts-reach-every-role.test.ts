import { describe, it, expect, vi } from "vitest";
import type { AgentRole } from "../packages/shared/src/index";
import type { SearchHit } from "../packages/core/src/index";
import { classifyEntry } from "../packages/agents/src/agents/classifier/classify";
import { extractGraph } from "../packages/agents/src/agents/graph/extract-graph";
import { rerankLLM } from "../packages/agents/src/agents/reranker/rerank";
import { synthesizeContextAnswer } from "../packages/agents/src/agents/retriever/synthesize";
import { distill } from "../packages/agents/src/agents/distiller/distill";
import { mergeKnowledge } from "../packages/agents/src/agents/merger/merge";
import { reconcile } from "../packages/agents/src/agents/reconciler/reconcile";

const runAgent = vi.fn(async (..._args: unknown[]) => "{}");
vi.mock("../packages/agents/src/runtime/run-agent.js", () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
vi.mock("../packages/agents/src/runtime/registry.js", () => ({ getAgent: () => ({}) }));

const hit = { score: 1, entry: { type: "decision", title: "Use ULIDs", summary: "Public ids are ULIDs." } } as unknown as SearchHit;
const PROJECT = "project-id";

const CALLS: Record<AgentRole, () => Promise<unknown>> = {
  classifier: () => classifyEntry("a memo", { language: "en", projectId: PROJECT }),
  graph: () => extractGraph("a memo", { language: "en", projectId: PROJECT }),
  reranker: () => rerankLLM("a question", [hit, hit], { projectId: PROJECT }),
  retriever: () => synthesizeContextAnswer("a question", [{ type: "decision", title: "T", summary: "S" }], { projectId: PROJECT }),
  distiller: () => distill("P", "a window", { projectId: PROJECT }),
  merger: () => mergeKnowledge("an entry", "another", { language: "en", projectId: PROJECT }),
  reconciler: () => reconcile("an entry", "another", { projectId: PROJECT }),
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
      const [calledRole, , opts] = runAgent.mock.calls[0] ?? [];
      if (calledRole !== role || (opts as { projectId?: string } | undefined)?.projectId !== PROJECT) lost.push(role);
    }
    expect(lost).toEqual([]);
  });
});
