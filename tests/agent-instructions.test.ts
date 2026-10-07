import { describe, it, expect } from "vitest";
import type { SearchHit } from "../packages/core/src/index";
import { AGENT_ROLES, type AgentRole } from "../packages/agents/src/runtime/roles";
import { JSON_ROLES } from "../packages/agents/src/runtime/model";
import { defaultCriterion, instructionsFor } from "../packages/agents/src/runtime/registry";
import { classifierPrompt } from "../packages/agents/src/agents/classifier/prompt";
import { graphPrompt } from "../packages/agents/src/agents/graph/prompt";
import { rerankerPrompt } from "../packages/agents/src/agents/reranker/prompt";
import { retrieverPrompt } from "../packages/agents/src/agents/retriever/prompt";
import { distillerPrompt } from "../packages/agents/src/agents/distiller/prompt";
import { mergerPrompt } from "../packages/agents/src/agents/merger/prompt";
import { reconcilerPrompt } from "../packages/agents/src/agents/reconciler/prompt";

const WRITING_ROLES: AgentRole[] = ["classifier", "graph", "retriever", "distiller", "merger"];

const hit = { score: 1, entry: { type: "decision", title: "Use ULIDs", summary: "Public ids are ULIDs." } } as unknown as SearchHit;

const PROMPTS: Record<AgentRole, string> = {
  classifier: classifierPrompt("a memo"),
  graph: graphPrompt("a memo"),
  reranker: rerankerPrompt("a question", [hit]),
  retriever: retrieverPrompt("a question", [{ type: "decision", title: "Use ULIDs", summary: "Public ids are ULIDs." }]),
  distiller: distillerPrompt("P", "a window"),
  merger: mergerPrompt("an entry", "another"),
  reconciler: reconcilerPrompt("an entry", "another"),
};

function fiveWordRuns(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z_'-]+/g) ?? [];
  return words.slice(0, -4).map((_, i) => words.slice(i, i + 5).join(" "));
}

/**
 * An admin or a project can rewrite what a role judges by (ADR-0088), and the code still parses
 * what the model answers. A format sentence living inside the criterion would leave with it, and
 * the role would answer in a shape nothing reads or in a language nobody chose.
 */
describe("a role's instructions are its criterion followed by a contract nobody rewrites", () => {
  it("keeps the same contract whatever criterion it is given, and drops the default one", () => {
    const custom = "Only what touches invoicing matters here.";
    const broken = AGENT_ROLES.filter((role) => {
      const withDefault = instructionsFor(role, "es");
      const withCustom = instructionsFor(role, "es", custom);
      const contract = withCustom.slice(custom.length);
      return (
        !withCustom.startsWith(custom) ||
        withCustom.includes(defaultCriterion(role)) ||
        withDefault !== `${defaultCriterion(role)}${contract}` ||
        contract.trim() === ""
      );
    });
    expect(broken).toEqual([]);
  });

  it("asks for JSON from every role whose answer is parsed, and for the project's language from every role that writes", () => {
    const contractOf = (role: AgentRole) => instructionsFor(role, "es", "x").slice(1);
    const missing = [
      ...[...JSON_ROLES].filter((role) => !contractOf(role).includes("JSON")).map((role) => `${role}: JSON`),
      ...WRITING_ROLES.filter((role) => !contractOf(role).includes("Spanish")).map((role) => `${role}: language`),
    ];
    expect(missing).toEqual([]);
  });

  it("keeps the distiller's ban on secrets out of reach of any criterion", () => {
    expect(instructionsFor("distiller", "en", "Keep everything.")).toContain("NEVER include secrets");
  });
});

/**
 * A line of judgement left in the per-call prompt is still sent after the criterion was
 * rewritten, and contradicts it: the reranker's prompt said "include only the ones that
 * contribute something" whatever its system prompt said.
 */
describe("the per-call prompt carries the data and the format, and none of the criterion", () => {
  it("shares no run of five words with its role's default criterion", () => {
    const repeated = AGENT_ROLES.flatMap((role) => {
      const prompt = PROMPTS[role].toLowerCase().replace(/\s+/g, " ");
      return fiveWordRuns(defaultCriterion(role))
        .filter((run) => prompt.includes(run))
        .map((run) => `${role}: "${run}"`);
    });
    expect(repeated).toEqual([]);
  });
});
