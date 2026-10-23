import { describe, it, expect } from "vitest";
import { isReviewLane, mergeByHand, oldestFirst } from "../packages/core/src/knowledge/domain/memo-merge";
import { splitTitle } from "../packages/agents/src/agents/merger/draft";
import { reviewMergePrompt } from "../packages/agents/src/agents/merger/prompt";

const OLDER = { title: "Fixed backoff", content: "Retries wait a fixed 30 s.", type: "decision" as const, createdAt: new Date("2026-09-01T10:00:00Z") };
const NEWER = { title: "Exponential backoff", content: "Retries back off exponentially, capped at 60 s.", type: "constraint" as const, createdAt: new Date("2026-10-20T10:00:00Z") };

/*
 * Two memos that look alike are not always one right and one wrong: each can hold half of it, and
 * Review only let a person keep, discard or rewrite one of them (ADR-0096).
 */
describe("a merge a person does by hand, without a model", () => {
  it("starts from the newer memo, which is the one taken as true, and keeps the older text below it", () => {
    expect(mergeByHand([OLDER, NEWER])).toEqual({
      title: "Exponential backoff",
      type: "constraint",
      content: "Retries back off exponentially, capped at 60 s.\n\nRetries wait a fixed 30 s.",
    });
  });

  it("whatever order the memos arrive in", () => {
    expect(mergeByHand([NEWER, OLDER])).toEqual(mergeByHand([OLDER, NEWER]));
    expect(oldestFirst([NEWER, OLDER]).map((m) => m.title)).toEqual(["Fixed backoff", "Exponential backoff"]);
  });
});

describe("the merge the consolidation agent drafts", () => {
  it("is shown the memos in order, each with its type and the day it was saved", () => {
    const prompt = reviewMergePrompt([OLDER, NEWER]);
    expect(prompt.indexOf("Fixed backoff")).toBeLessThan(prompt.indexOf("Exponential backoff"));
    for (const fact of ["decision · saved 2026-09-01", "constraint · saved 2026-10-20"]) expect(prompt).toContain(fact);
  });

  it("takes its first line as the title, even dressed up as a heading", () => {
    const body = "Retries back off exponentially from 30 s, capped at 60 s.";
    const answers = [`Retry backoff\n${body}`, `# Retry backoff\n\n${body}`, `**Retry backoff**\n${body}`, `Title: Retry backoff\n${body}`];
    expect(answers.map(splitTitle)).toEqual(answers.map(() => ({ title: "Retry backoff", content: body })));
  });

  it("an answer with no text under the title is no draft, so the person merges by hand", () => {
    expect([splitTitle("Retry backoff"), splitTitle(""), splitTitle("\n\n")]).toEqual([null, null, null]);
  });
});

describe("which lane a merge comes from", () => {
  it("the older memos or the new ones, and nothing else a form could carry", () => {
    expect(["older", "new", "both", ""].filter(isReviewLane)).toEqual(["older", "new"]);
  });
});
