import { describe, it, expect, afterEach } from "vitest";
import {
  configureCore,
  confidenceAfterReview,
  isReviewVerdict,
  NotAReviewerError,
  resetCore,
  resolveUnchecked,
  validateEntry,
} from "../packages/core/src/index";
import type { MemoRepository } from "../packages/core/src/knowledge/domain/memo-repository";
import type { ReviewWrite } from "../packages/core/src/knowledge/domain/review";
import type { VerificationQueue } from "../packages/core/src/knowledge/domain/verification-queue";
import type { ProjectRepository } from "../packages/core/src/projects/domain/project-repository";

afterEach(() => resetCore());

/*
 * Validating used to change only `status`, while the pack orders by `confidence`: a memo a person
 * had confirmed ranked below one nobody had read, and "yes, it holds" changed nothing an agent saw.
 * And an agent validating through MCP must not count as a person doing it (ADR-0090).
 */
describe("what a review does to a memo's confidence", () => {
  it("a person validating it in the web UI makes it verified", () => {
    expect(confidenceAfterReview("validated", "web")).toBe("verified");
  });

  it("an agent validating it through MCP leaves the confidence as it was", () => {
    expect(confidenceAfterReview("validated", "mcp")).toBeNull();
  });

  it("rejecting it or marking it obsolete leaves the confidence as it was, from anywhere", () => {
    for (const verdict of ["rejected", "obsolete"] as const) {
      for (const channel of ["web", "mcp"] as const) expect(confidenceAfterReview(verdict, channel), `${verdict} ${channel}`).toBeNull();
    }
  });
});

/*
 * The web route used to cast whatever the form posted into a status, so a forged post could set
 * `superseded` or `draft` on any entry its sender could read.
 */
describe("which verdicts a review accepts", () => {
  it("validated, rejected and obsolete, and none of the other statuses", () => {
    const accepted = ["validated", "rejected", "obsolete", "draft", "pending_validation", "superseded", ""].filter(isReviewVerdict);
    expect(accepted).toEqual(["validated", "rejected", "obsolete"]);
  });
});

describe("validating an entry", () => {
  it("hands the port the verdict, who gave it, from where, and the confidence it earns", async () => {
    const writes: { id: string; write: ReviewWrite }[] = [];
    const recording = {
      review: async (id: string, write: ReviewWrite) => {
        writes.push({ id, write });
        return null;
      },
    } as unknown as MemoRepository;
    configureCore({ memos: recording });

    await validateEntry("m1", "validated", { email: "ana@example.com", channel: "web" });
    await validateEntry("m2", "validated", { email: null, channel: "mcp" });

    expect(writes).toEqual([
      { id: "m1", write: { verdict: "validated", reviewer: { email: "ana@example.com", channel: "web" }, confidence: "verified" } },
      { id: "m2", write: { verdict: "validated", reviewer: { email: null, channel: "mcp" }, confidence: null } },
    ]);
  });
});

/*
 * The same key decides both lanes of Review, and it must not record the same verdict: an older memo
 * discarded held once, so it is obsolete; a new memo rejected was never true (ADR-0093).
 */
describe("a decision on a memo nobody has checked", () => {
  const OWNER = { email: "ana@example.com" };
  const project = { id: "p1", name: "Acme" };

  function wire({ waiting }: { waiting: boolean }) {
    const verdicts: { id: string; write: ReviewWrite }[] = [];
    const skipped: string[] = [];
    configureCore({
      projects: {
        chain: async () => [{ id: "p1", visibility: "private", ownerEmail: OWNER.email }],
        isMember: async () => false,
      } as unknown as ProjectRepository,
      memos: {
        review: async (id: string, write: ReviewWrite) => {
          verdicts.push({ id, write });
          return null;
        },
      } as unknown as MemoRepository,
      verificationQueue: {
        isPending: async () => waiting,
        skip: async (id: string) => {
          skipped.push(id);
        },
      } as unknown as VerificationQueue,
    });
    return { verdicts, skipped };
  }

  it("rejecting it records that it is wrong, not that it stopped being true", async () => {
    const { verdicts } = wire({ waiting: true });
    await resolveUnchecked(project, "m1", "discard", OWNER);
    expect(verdicts.map((v) => v.write.verdict)).toEqual(["rejected"]);
  });

  it("confirming it is a person vouching for it, so it becomes verified", async () => {
    const { verdicts } = wire({ waiting: true });
    await resolveUnchecked(project, "m1", "keep", OWNER);
    expect(verdicts).toEqual([
      { id: "m1", write: { verdict: "validated", reviewer: { email: OWNER.email, channel: "web" }, confidence: "verified" } },
    ]);
  });

  it("skipping it gives no verdict", async () => {
    const { verdicts, skipped } = wire({ waiting: true });
    await resolveUnchecked(project, "m1", "skip", OWNER);
    expect([verdicts, skipped]).toEqual([[], ["m1"]]);
  });

  it("a memo no longer waiting -- a second click, a stale tab -- is left alone", async () => {
    const { verdicts, skipped } = wire({ waiting: false });
    await resolveUnchecked(project, "m1", "discard", OWNER);
    expect([verdicts, skipped]).toEqual([[], []]);
  });

  it("somebody off the team is refused before anything is written", async () => {
    const { verdicts } = wire({ waiting: true });
    await expect(resolveUnchecked(project, "m1", "keep", { email: "passer-by@example.com" })).rejects.toBeInstanceOf(NotAReviewerError);
    expect(verdicts).toEqual([]);
  });
});
