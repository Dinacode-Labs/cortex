import { describe, it, expect } from "vitest";
import { changesSomething } from "../packages/core/src/knowledge/domain/memo-suggestion";
import { parseSuggestion } from "../packages/agents/src/agents/editor/edit";
import { editorPrompt } from "../packages/agents/src/agents/editor/prompt";

const MEMO = {
  id: "memo-id",
  title: "Backoff",
  content: "Yesterday we found the retries were hammering the API, so now they back off exponentially.",
  type: "decision" as const,
  sourceType: "agent_session" as const,
  createdAt: new Date("2026-10-23T10:00:00Z"),
};

/*
 * What the editing agent answers may end up as a memo's text once a person saves it (ADR-0099). An
 * answer the code half understood would put words in front of a person as the agent's that the
 * agent never meant, or rewrite a memo into nothing.
 */
describe("what the editing agent answers", () => {
  it("a rewrite carries its title, its text and why it reads better", () => {
    const answer = '```json\n{"suggestion":"rewrite","reason":"It says when, not what holds.","title":"Retries back off exponentially","content":"Retries back off exponentially (since 2026-10-22), so they no longer hammer the API."}\n```';
    expect(parseSuggestion(answer)).toEqual({
      kind: "rewrite",
      reason: "It says when, not what holds.",
      title: "Retries back off exponentially",
      content: "Retries back off exponentially (since 2026-10-22), so they no longer hammer the API.",
    });
  });

  it("a rejection needs a reason a person can weigh", () => {
    expect(parseSuggestion('{"suggestion":"reject","reason":"It is the progress of a task."}')).toEqual({ kind: "reject", reason: "It is the progress of a task." });
    expect(parseSuggestion('{"suggestion":"reject","reason":"  "}')).toBeNull();
  });

  it("nothing to suggest, a rewrite without text and an answer out of shape are all no suggestion", () => {
    const answers = [
      '{"suggestion":"none","reason":"It reads well."}',
      '{"suggestion":"rewrite","reason":"x","title":"A title"}',
      '{"suggestion":"rewrite","reason":"x","title":"","content":"Some text"}',
      '{"suggestion":"shorten","reason":"x"}',
      "It reads fine to me.",
      "null",
    ];
    expect(answers.map(parseSuggestion)).toEqual(answers.map(() => null));
  });
});

describe("a rewrite worth a person's reading", () => {
  it("changes the title or the text; the same words back are no suggestion", () => {
    const same = { kind: "rewrite" as const, reason: "x", title: " Backoff ", content: `${MEMO.content}\n` };
    expect(changesSomething(MEMO, same)).toBe(false);
    expect(changesSomething(MEMO, { ...same, title: "Retries back off exponentially" })).toBe(true);
    expect(changesSomething(MEMO, { kind: "reject", reason: "x" })).toBe(true);
  });
});

describe("what the editing agent is shown", () => {
  it("the memo with the day it was saved, so a relative date can become that day, and where it came from", () => {
    const prompt = editorPrompt(MEMO);
    for (const shown of ["decision saved on 2026-10-23", "from agent_session", MEMO.content]) expect(prompt).toContain(shown);
  });

  it("what the project always and never keeps, when it says", () => {
    const prompt = editorPrompt(MEMO, { types: {}, keep: ["the why of each decision"], discard: ["release dates"] });
    expect(prompt).toContain("This project always keeps: the why of each decision.");
    expect(prompt).toContain("This project never keeps: release dates.");
    expect(editorPrompt(MEMO, { types: {}, keep: [], discard: [] })).not.toContain("This project");
  });
});
