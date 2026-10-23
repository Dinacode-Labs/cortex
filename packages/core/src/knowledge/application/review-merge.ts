import { getEnvNum, scrub, type Language } from "@cortex/shared";
import { port } from "../../composition.js";
import type { SessionUser } from "../../auth/domain/session-user.js";
import { canReviewProject, languageOfProject, NotAReviewerError } from "../../projects/application/projects.js";
import type { ProjectRef } from "../../projects/domain/project.js";
import type { Memo } from "../domain/memo.js";
import {
  mergeByHand,
  oldestFirst,
  type MergeDraft,
  type MergedMemo,
  type MergeProposal,
  type MergeSource,
  type ReviewLane,
} from "../domain/memo-merge.js";
import { invalidateEntry } from "./dedup.js";
import { validateEntry } from "./review.js";
import { saveContext } from "./save.js";
import { CHECK_ORDER } from "./verification-queue.js";

/** It is handed the memos oldest first. Null, or a throw, leaves the texts for a person to merge. */
export type MergeDrafter = (memos: MergeSource[], context: { language: Language; projectId: string | null }) => Promise<MergeDraft | null>;

/**
 * How many reviews of each lane get their merge drafted ahead, per project: the next few, not the
 * whole queue, which a bulk upload can fill with hundreds nobody reaches for days (ADR-0096).
 */
export const MERGE_DRAFTS_AHEAD = getEnvNum("CORTEX_MERGE_DRAFTS_AHEAD", 10);

let drafter: MergeDrafter | null = null;

export function setMergeDrafter(fn: MergeDrafter | null): void {
  drafter = fn;
}

/** The memo in question and the ones its lane set it against: a form cannot merge one the screen never showed. */
async function shownTogether(project: Pick<ProjectRef, "id">, lane: ReviewLane, memoId: string): Promise<{ memo: Memo; others: Memo[] } | null> {
  if (lane === "older") {
    const review = await port("reviewQueue").pending(project.id, memoId);
    return review && { memo: review.memo, others: review.newer.map((n) => n.memo) };
  }
  if (!(await port("verificationQueue").isPending(project.id, memoId))) return null;
  const detail = await port("memoReader").detail(memoId);
  if (!detail) return null;
  const touches = await port("reviewQueue").raisedBy(project.id, memoId);
  return { memo: detail.entry, others: touches.map((t) => t.memo) };
}

async function memosToMerge(project: Pick<ProjectRef, "id">, lane: ReviewLane, memoId: string, withIds: string[]): Promise<Memo[] | null> {
  const shown = await shownTogether(project, lane, memoId);
  const chosen = shown?.others.filter((m) => withIds.includes(m.id)) ?? [];
  return shown && chosen.length > 0 ? oldestFirst([shown.memo, ...chosen]) : null;
}

// The model's text is kept and shown later, so it is scrubbed like anything else persisted.
async function draftAndKeep(projectId: string, memos: Memo[], draft: MergeDrafter): Promise<MergeDraft | null> {
  const { effective: language } = await languageOfProject(projectId);
  const drafted = await draft(memos, { language, projectId }).catch(() => null);
  const kept = drafted && { title: scrub(drafted.title), content: scrub(drafted.content) };
  await port("mergeDrafts").save(projectId, memos, kept);
  return kept;
}

/** Each review Review will show next in either lane, as the memos merging it would replace. */
async function upcomingMerges(projectId: string, ahead: number): Promise<Memo[][]> {
  const older = await port("reviewQueue").upcoming(projectId, ahead);
  const groups = older.map((review) => [review.memo, ...review.newer.map((n) => n.memo)]);
  for (const memo of await port("verificationQueue").upcoming(projectId, CHECK_ORDER, ahead)) {
    const touches = await port("reviewQueue").raisedBy(projectId, memo.id);
    if (touches.length > 0) groups.push([memo, ...touches.map((t) => t.memo)]);
  }
  return groups.map(oldestFirst);
}

/**
 * Drafts ahead so the merge is waiting when a person reaches the review (ADR-0096). A set already
 * drafted, or that failed, is not asked for again until one of its memos changes. Returns how many
 * it drafted.
 */
export async function draftMergesAhead(projectIds?: string[], ahead = MERGE_DRAFTS_AHEAD): Promise<number> {
  if (!drafter || ahead <= 0) return 0;
  const ids = projectIds ?? (await port("memoReader").projectsWithCounts()).map((p) => p.entity.id);
  let drafted = 0;
  for (const projectId of ids) {
    for (const memos of await upcomingMerges(projectId, ahead)) {
      if (await port("mergeDrafts").tried(memos)) continue;
      if (await draftAndKeep(projectId, memos, drafter)) drafted++;
    }
  }
  return drafted;
}

export async function pruneMergeDrafts(): Promise<number> {
  return port("mergeDrafts").prune();
}

/** Only what is already drafted: the review screen never waits on a model. */
export async function preparedMerge(memos: Memo[]): Promise<MergeDraft | null> {
  return port("mergeDrafts").find(memos);
}

/**
 * The draft prepared ahead when there is one. Otherwise -- the pass has not reached it, it failed,
 * or the person left a memo out -- the model is asked now. Null once the memo no longer waits.
 */
export async function proposeMerge(
  project: Pick<ProjectRef, "id" | "name">,
  lane: ReviewLane,
  memoId: string,
  withIds: string[],
  actor: SessionUser,
): Promise<MergeProposal | null> {
  if (!(await canReviewProject(project, actor))) throw new NotAReviewerError(project.name);
  const memos = await memosToMerge(project, lane, memoId, withIds);
  if (!memos) return null;
  const ready = await port("mergeDrafts").find(memos);
  const drafted = ready ?? (drafter ? await draftAndKeep(project.id, memos, drafter) : null);
  return { ...mergeByHand(memos), ...drafted, memos, drafted: drafted !== null };
}

/**
 * The merged memo is a person's and verified, and it supersedes every memo it merges, which takes
 * each of them out of both lanes. Saved like any other, it puts up for review whatever else it is
 * about (ADR-0091). Merging a memo that no longer waits -- a second click, a stale tab -- does nothing.
 */
export async function mergeInReview(
  project: Pick<ProjectRef, "id" | "name">,
  lane: ReviewLane,
  memoId: string,
  withIds: string[],
  merged: MergedMemo,
  actor: SessionUser,
): Promise<Memo | null> {
  if (!(await canReviewProject(project, actor))) throw new NotAReviewerError(project.name);
  const content = merged.content.trim();
  if (!content) return null;
  const memos = await memosToMerge(project, lane, memoId, withIds);
  if (!memos) return null;

  const { entry } = await saveContext({
    project: project.name,
    title: merged.title.trim() || undefined,
    content,
    type: merged.type,
    sourceType: "manual",
    createdBy: actor.email,
    metadata: { mergedFrom: memos.map((m) => m.id) },
  });
  await validateEntry(entry.id, "validated", { email: actor.email, channel: "web" });
  for (const memo of memos) {
    await invalidateEntry(memo.id, entry.id);
    await port("reviewQueue").resolve(memo.id, "merged", actor.email);
  }
  return entry;
}
