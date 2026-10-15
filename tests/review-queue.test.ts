import { describe, it, expect } from "vitest";
import { isReviewDecision, olderMemosToReview } from "../packages/core/src/knowledge/domain/review-queue";
import type { SearchHit } from "../packages/core/src/knowledge/domain/memo-index";

const hit = (id: string, score: number) => ({ entry: { id }, score }) as unknown as SearchHit;

/*
 * The reconciler only ever compared a new memo with the single nearest one, and only from 0.82:
 * an older memo saying the opposite in other words was never looked at again (ADR-0091).
 */
describe("which older memos a newer one puts up for review", () => {
  it("every neighbour from the threshold up, not just the nearest", () => {
    const neighbours = [hit("a", 0.93), hit("b", 0.78), hit("c", 0.75), hit("d", 0.74), hit("e", 0.3)];
    expect(olderMemosToReview(neighbours, 0.75)).toEqual([
      { memoId: "a", similarity: 0.93 },
      { memoId: "b", similarity: 0.78 },
      { memoId: "c", similarity: 0.75 },
    ]);
  });

  it("none when nothing is about the same thing", () => {
    expect(olderMemosToReview([hit("x", 0.4)], 0.75)).toEqual([]);
  });
});

describe("which decisions the Review section takes", () => {
  it("keep, discard, modify and skip, and nothing else a form could carry", () => {
    const taken = ["keep", "discard", "modify", "skip", "purge", "validated", ""].filter(isReviewDecision);
    expect(taken).toEqual(["keep", "discard", "modify", "skip"]);
  });
});
