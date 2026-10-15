import type { ConfidenceLevel } from "@cortex/shared";
import type { MemoStatus } from "./memo.js";

export type ReviewVerdict = Extract<MemoStatus, "validated" | "rejected" | "obsolete">;
export type ReviewChannel = "web" | "mcp";

const REVIEW_VERDICTS: readonly ReviewVerdict[] = ["validated", "rejected", "obsolete"];

export function isReviewVerdict(value: string): value is ReviewVerdict {
  return (REVIEW_VERDICTS as readonly string[]).includes(value);
}

export interface Reviewer {
  /** Null only from an MCP server over stdio, which has nobody signed in. */
  email: string | null;
  channel: ReviewChannel;
}

export interface MemoReview {
  verdict: ReviewVerdict;
  channel: ReviewChannel;
  reviewedBy: string | null;
  reviewedAt: Date;
}

export interface ReviewWrite {
  verdict: ReviewVerdict;
  reviewer: Reviewer;
  /** Null leaves the memo's confidence as it was. */
  confidence: ConfidenceLevel | null;
}

/**
 * The pack orders by confidence, so a person's "yes, it holds" has to reach it or validating
 * changes nothing an agent sees. An agent validating through MCP records its verdict and leaves
 * the confidence alone: a model's judgement does not become a fact (ADR-0090).
 */
export function confidenceAfterReview(verdict: ReviewVerdict, channel: ReviewChannel): ConfidenceLevel | null {
  return verdict === "validated" && channel === "web" ? "verified" : null;
}
