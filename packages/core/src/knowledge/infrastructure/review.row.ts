import type { Row } from "@cortex/database";
import type { MemoReview } from "../domain/review.js";

export function rowToReview(row: Row): MemoReview {
  return {
    verdict: row.verdict,
    channel: row.channel,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at,
  };
}
