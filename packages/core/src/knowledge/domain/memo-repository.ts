import type { ConfidenceLevel, SourceType } from "@cortex/shared";
import type { Memo, MemoType } from "./memo.js";

/** A source to persist, before it has an id. */
export interface NewSource {
  sourceType: SourceType;
  rawContent: string;
  metadata: Record<string, unknown>;
}

/** A memo to persist, before it has an id. */
export interface NewMemo {
  projectId: string | null;
  sourceId: string;
  title: string;
  content: string;
  summary: string;
  type: MemoType;
  confidence: ConfidenceLevel;
  sourceType: SourceType;
  sourceReference: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
}

/** An entry a reclassification pass may retype, with what the pass needs to judge it. */
export interface ReclassifiableMemo {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  type: MemoType;
  metadata: Record<string, unknown>;
}

/** An entry whose summary may be rebuilt from its content. */
export interface SummarizableMemo {
  id: string;
  projectId: string | null;
  title: string;
  content: string;
  summary: string | null;
}

/** What a purge needs to know about an entry before it is deleted (ADR-0072). */
export interface PurgeTarget {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  projectName: string | null;
}

/**
 * The port the knowledge module writes through. It exists so the creation rules (ADR-0076) can
 * be read and tested without a database; the pg adapter lives in `infrastructure/`.
 */
export interface MemoRepository {
  createSource(source: NewSource): Promise<string>;
  createMemo(memo: NewMemo): Promise<Memo>;
  /**
   * Lifecycle, in bulk. The rules are predicates over the whole table, so they stay in the
   * adapter as one statement each: loading the rows to pass them through an object and write
   * them back would lose the atomicity and pay for the round trip (ADR-0076).
   */
  closeHistoricalStates(): Promise<number>;
  applySupersessions(): Promise<number>;
  promoteCorroborated(): Promise<number>;
  decayUncorroborated(decayDays: number): Promise<number>;
  /**
   * Reconciliation writes. The decision (add/noop/update/supersede) is the use case's; these
   * are only the ways an entry changes once that decision is made.
   */
  recordCorroboration(memoId: string): Promise<void>;
  invalidate(memoId: string, supersededById: string): Promise<void>;
  updateMemoFields(memoId: string, fields: { title?: string; content?: string }): Promise<boolean>;
  updateMemoContent(memoId: string, content: string): Promise<void>;
  findNearDuplicatePairs(projectId: string, maxDistance: number, skipFormats: string[]): Promise<{ keep: string; drop: string }[]>;
  /** Current entries that share an entity with these, for the contradiction check. */
  findContradictionCandidates(entityIds: string[], excludeId: string): Promise<Memo[]>;
  /**
   * Deferred reclassification and summary rebuilding. Which entries qualify and what is written
   * are decided in the use case; these load the candidates and apply one write each.
   */
  findIdBySourceReference(projectId: string, sourceReference: string): Promise<string | null>;
  findReclassifiable(projectId: string): Promise<ReclassifiableMemo[]>;
  findSummariesToRebuild(projectId: string | null): Promise<SummarizableMemo[]>;
  retype(id: string, change: { type: MemoType; summary: string | null; metadata: Record<string, unknown> }): Promise<void>;
  updateSummary(id: string, summary: string): Promise<void>;
  /**
   * Purging (ADR-0072): the entry is deleted for good, its superseded dependants become current
   * again, and the sources and entities left with nothing pointing at them go too. The permission
   * check is the use case's; `purgedBy` is the audit trail in `entry_purges`.
   */
  findPurgeTargets(ids: string[]): Promise<PurgeTarget[]>;
  purge(ids: string[], purgedBy: string): Promise<string[]>;
}
