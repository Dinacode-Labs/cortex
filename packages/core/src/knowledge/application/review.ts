import { port } from "../../composition.js";
import type { Memo } from "../domain/memo.js";
import { confidenceAfterReview, type Reviewer, type ReviewVerdict } from "../domain/review.js";

export async function validateEntry(id: string, verdict: ReviewVerdict, reviewer: Reviewer): Promise<Memo | null> {
  return port("memos").review(id, { verdict, reviewer, confidence: confidenceAfterReview(verdict, reviewer.channel) });
}
