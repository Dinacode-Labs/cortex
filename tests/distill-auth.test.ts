import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A wrong key must not look like "this session had nothing worth storing".
 *
 * It happened while deploying the server: with the wrong key, capture returned
 * `saved: 0, failed: 0` and the status `done`. All green, zero knowledge, and it would have
 * stayed that way until somebody wondered why the memory was still empty.
 */
const runAgent = vi.fn();
vi.mock("../packages/agents/src/runtime/run-agent.js", () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));

beforeEach(() => {
  runAgent.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function distill() {
  return (await import("../packages/agents/src/agents/distiller/distill.js")).distill;
}

describe("distill facing a provider failure", () => {
  it("throws when the key is rejected, so the failure reaches the top", async () => {
    runAgent.mockRejectedValue(Object.assign(new Error("Invalid API key."), { statusCode: 401 }));
    await expect((await distill())("P", "x".repeat(300))).rejects.toThrow(/rejecting the key/);
  });

  it("detects it when it only comes through in the text too", async () => {
    runAgent.mockRejectedValue(new Error("AI_APICallError: Unauthorized"));
    await expect((await distill())("P", "x".repeat(300))).rejects.toThrow(/rejecting the key/);
  });

  it("with no LLM configured it is NOT a failure: it is a deliberate state", async () => {
    // core falls back to heuristics and Cortex stays useful with no key at all.
    runAgent.mockRejectedValue(new Error("LLM not enabled (LLM_PROVIDER / API key)."));
    await expect((await distill())("P", "x".repeat(300))).resolves.toEqual([]);
  });

  it("a window returning garbage is skipped, without bringing the session down", async () => {
    // A model that invents the format is recoverable: the other windows may be fine.
    runAgent.mockResolvedValue("this is nowhere near JSON");
    await expect((await distill())("P", "x".repeat(300))).resolves.toEqual([]);
  });

  it("the ordinary path still works", async () => {
    runAgent.mockResolvedValue('{"items":[{"type":"decision","title":"T","content":"C"}]}');
    const items = await (await distill())("P", "x".repeat(300));
    expect(items).toEqual([{ type: "decision", title: "T", content: "C" }]);
  });
});
