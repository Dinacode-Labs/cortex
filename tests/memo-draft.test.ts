import { describe, it, expect } from "vitest";
import { MemoDraft } from "../packages/core/src/knowledge/domain/memo.js";

/**
 * The creation rules of a memo used to live inside `saveContext`, next to the three INSERTs
 * and the classifier wiring, so testing them meant standing up a database. They live in the
 * aggregate now (ADR-0076): this file is the proof that a rule can be checked without one.
 */
describe("the memo a piece of knowledge becomes", () => {
  it("lets the caller's explicit fields win over both the model and the heuristic", () => {
    const draft = MemoDraft.from(
      { content: "We decided to use Postgres.", type: "risk", title: "Explicit title", summary: "Explicit summary." },
      { type: "decision", title: "From the model", summary: "From the model." },
    );

    expect(draft.type).toBe("risk");
    expect(draft.title).toBe("Explicit title");
    expect(draft.summary).toBe("Explicit summary.");
  });

  it("takes the type and the title from the model when the caller did not set them", () => {
    const draft = MemoDraft.from(
      { content: "We decided to use Postgres." },
      { type: "decision", title: "Use Postgres", summary: "It is the only one with pgvector." },
    );

    expect(draft.type).toBe("decision");
    expect(draft.title).toBe("Use Postgres");
    expect(draft.enrichedBy).toBe("llm");
  });

  it("never lets the summary repeat the title that will sit right above it", () => {
    const title = "Use Postgres as the only store";
    const draft = MemoDraft.from(
      { content: "x", title, summary: `${title}, because it is the only one with pgvector today and tomorrow.` },
      null,
    );

    expect(draft.summary.startsWith(title)).toBe(false);
    expect(draft.summary).toContain("pgvector");
  });

  it("drops a project extracted as an entity and collapses case variants", () => {
    const draft = MemoDraft.from(
      { content: "Nothing to extract here." },
      {
        entities: [
          { name: "Acme", type: "client" },
          { name: "acme", type: "client" },
          { name: "Cortex", type: "project" },
        ],
      },
    );

    expect(draft.entities).toEqual([{ name: "Acme", type: "client" }]);
  });

  it("embeds the title over the content, so the title weighs in retrieval", () => {
    const draft = MemoDraft.from({ content: "Body of the entry." }, { title: "A title", type: "module_note" });

    expect(draft.embedText).toBe("A title\n\nBody of the entry.");
  });

  it("marks the enrichment as heuristic when no classifier answered", () => {
    const draft = MemoDraft.from({ content: "We decided to use Postgres." }, null);

    expect(draft.enrichedBy).toBe("heuristic");
  });
});
