import type { Memo } from "./memo.js";
import type { SearchHit } from "./memo-index.js";
import { oldestFirst } from "./memo-merge.js";

export type GroupRelation = "duplicate" | "overlap" | "contradiction";

export function isGroupRelation(value: unknown): value is GroupRelation {
  return value === "duplicate" || value === "overlap" || value === "contradiction";
}

/** What the agent says of a memo of the day and the older ones it read next to it. */
export interface JudgedGroup {
  memoIds: string[];
  relation: GroupRelation;
  reason: string;
}

export type JudgeSource = Pick<Memo, "id" | "title" | "content" | "type" | "createdAt">;

/**
 * A group raised as one review of the older lane: anchored on its oldest memo, every other one set
 * against it, so Review shows them side by side and can merge them in one go (ADR-0098).
 */
export interface SweepGroup {
  anchorId: string;
  members: { memoId: string; similarity: number }[];
  relation: GroupRelation | null;
  reason: string | null;
  priority: number;
}

export interface SweepLog {
  /** Null for a project never swept. */
  sweptUntil(projectId: string): Promise<Date | null>;
  record(projectId: string, until: Date): Promise<void>;
}

// A judged group goes before anything raised on similarity alone, and a contradiction first: two
// memos in force that disagree mislead an agent, where two that repeat each other only cost room.
const RELATION_WEIGHT: Record<GroupRelation, number> = { contradiction: 3, duplicate: 2, overlap: 1 };

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Without a model, the memo of the day and what reads close enough to it to be the same thing. */
export function alikeGroup(memo: Pick<Memo, "id">, neighbours: SearchHit[], threshold: number): string[] {
  const alike = neighbours.filter((hit) => hit.score >= threshold).map((hit) => hit.entry.id);
  return alike.length > 0 ? [memo.id, ...alike] : [];
}

/**
 * Null when every memo of the group is already set against its oldest one, pending or decided: a
 * person's verdict on a pair is not asked for again.
 */
export function sweepGroup(
  memos: Memo[],
  similarityToOldest: Map<string, number>,
  knownPairs: Set<string>,
  judged: Pick<JudgedGroup, "relation" | "reason"> | null,
): SweepGroup | null {
  const [anchor, ...rest] = oldestFirst(memos);
  if (!anchor) return null;
  const members = rest
    .filter((m) => !knownPairs.has(pairKey(anchor.id, m.id)))
    .map((m) => ({ memoId: m.id, similarity: similarityToOldest.get(m.id) ?? 0 }));
  if (members.length === 0) return null;
  const closest = Math.max(...members.map((m) => m.similarity));
  return {
    anchorId: anchor.id,
    members,
    relation: judged?.relation ?? null,
    reason: judged?.reason || null,
    priority: (judged ? RELATION_WEIGHT[judged.relation] : 0) + closest,
  };
}

/** The most pressing first, and no more than a night should hand a person. */
export function groupsToRaise(groups: SweepGroup[], max: number): SweepGroup[] {
  return [...groups].sort((a, b) => b.priority - a.priority).slice(0, Math.max(0, max));
}
