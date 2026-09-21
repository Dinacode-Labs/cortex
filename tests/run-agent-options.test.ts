import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * Which incident this prevents: every role asks for an output cap (60 tokens for the
 * reconciler, 2000 for the classifier) and none of them was in force. The cap travelled at the
 * top level of `agent.generate()`'s options, where Mastra drops it with no warning, so the
 * generation traces recorded empty parameters and a pathological window could cost an unbounded
 * number of output tokens.
 *
 * The check is made on the request that leaves for the provider rather than on the options
 * object: what Mastra accepts and what it forwards are two different questions, and only the
 * second one bounds the bill. Real Mastra, real AI SDK, a stubbed `fetch` and no provider.
 */

process.env.LLM_PROVIDER = "openai-compatible";
process.env.LLM_BASE_URL = "http://llm.invalid/v1"; // .invalid never resolves: no request can escape
process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "test-model";

vi.mock("@cortex/core", () => ({ recordUsage: vi.fn() }));
vi.mock("@cortex/database", () => ({
  getSql: () => Object.assign(() => Promise.resolve([]), { json: (value: unknown) => value }),
}));

const ROLES = ["classifier", "graph", "reranker", "distiller", "reconciler", "merger", "retriever"] as const;

const completion = {
  id: "chatcmpl-test",
  created: 0,
  model: "test-model",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const fetchStub = vi.fn(
  async () => new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } }),
);
vi.stubGlobal("fetch", fetchStub);
afterAll(() => vi.unstubAllGlobals());

async function runAgent() {
  return (await import("../packages/agents/src/mastra.js")).runAgent;
}

function requestAt(i: number): Record<string, unknown> {
  const call = fetchStub.mock.calls[i] as [unknown, { body?: string }] | undefined;
  if (!call) throw new Error(`the provider was called ${fetchStub.mock.calls.length} time(s), not ${i + 1}`);
  return JSON.parse(call[1]?.body ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  fetchStub.mockClear();
});

describe("what runAgent asks the provider for", () => {
  it("caps the output: the role's ceiling arrives as max_tokens", async () => {
    await (await runAgent())("distiller", "a session window", { maxOutputTokens: 1500 });

    expect(requestAt(0)).toMatchObject({ model: "test-model", max_tokens: 1500, temperature: 0 });
  });

  it("asks for no ceiling when the caller gives none, rather than inventing one", async () => {
    await (await runAgent())("merger", "two entries");

    expect(requestAt(0)).not.toHaveProperty("max_tokens");
  });

  it("pins to temperature 0 the roles that answer JSON, and only those", async () => {
    const run = await runAgent();
    for (const role of ROLES) await run(role, "a prompt", { maxOutputTokens: 100 });

    const temperatures = Object.fromEntries(ROLES.map((role, i) => [role, requestAt(i).temperature]));
    expect(temperatures).toEqual({
      classifier: 0,
      graph: 0,
      reranker: 0,
      distiller: 0,
      reconciler: 0,
      merger: undefined,
      retriever: undefined,
    });
  });
});

describe("the Mastra that is installed", () => {
  /**
   * The shape above is not a convention of ours: it is what THIS version of @mastra/core
   * consumes. An upgrade that moved the knob would silently take the caps out of force again,
   * exactly as before, so the declaration is checked rather than remembered.
   */
  it("still takes the call settings through modelSettings, and not from the top level", () => {
    const requireFromAgents = createRequire(fileURLToPath(new URL("../packages/agents/package.json", import.meta.url)));
    const declarations = readFileSync(
      join(dirname(requireFromAgents.resolve("@mastra/core/agent")), "agent.types.d.ts"),
      "utf8",
    );
    const start = declarations.indexOf("export type AgentExecutionOptionsBase");
    expect(start, "AgentExecutionOptionsBase is gone: re-read how this Mastra takes the call settings").toBeGreaterThan(
      -1,
    );

    const executionOptions = declarations.slice(start, declarations.indexOf("\n};", start));
    expect(executionOptions).toContain("modelSettings?:");
    expect(executionOptions.match(/^ {4}(maxOutputTokens|temperature|maxRetries)\?:/gm)).toBeNull();
  });
});
