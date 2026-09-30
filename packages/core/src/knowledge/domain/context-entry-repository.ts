import type { ConfidenceLevel, ContextEntry, ContextEntryType, SourceType } from "@cortex/shared";

/** A source to persist, before it has an id. */
export interface NewSource {
  sourceType: SourceType;
  rawContent: string;
  metadata: Record<string, unknown>;
}

/** A context entry to persist, before it has an id. */
export interface NewContextEntry {
  projectId: string | null;
  sourceId: string;
  title: string;
  content: string;
  summary: string;
  type: ContextEntryType;
  confidence: ConfidenceLevel;
  sourceType: SourceType;
  sourceReference: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
}

/** An entry a reclassification pass may retype, with what the pass needs to judge it. */
export interface ReclassifiableEntry {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  type: ContextEntryType;
  metadata: Record<string, unknown>;
}

/** An entry whose summary may be rebuilt from its content. */
export interface SummarizableEntry {
  id: string;
  title: string;
  content: string;
  summary: string | null;
}

/**
 * The port the knowledge module writes through. It exists so the creation rules (ADR-0076) can
 * be read and tested without a database; the pg adapter lives in `infrastructure/`.
 */
export interface ContextEntryRepository {
  createSource(source: NewSource): Promise<string>;
  createEntry(entry: NewContextEntry): Promise<ContextEntry>;
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
  recordCorroboration(entryId: string): Promise<void>;
  invalidate(entryId: string, supersededById: string): Promise<void>;
  updateEntryFields(entryId: string, fields: { title?: string; content?: string }): Promise<boolean>;
  updateEntryContent(entryId: string, content: string): Promise<void>;
  findNearDuplicatePairs(projectId: string, maxDistance: number, skipFormats: string[]): Promise<{ keep: string; drop: string }[]>;
  /**
   * Deferred reclassification and summary rebuilding. Which entries qualify and what is written
   * are decided in the use case; these load the candidates and apply one write each.
   */
  findIdBySourceReference(projectId: string, sourceReference: string): Promise<string | null>;
  findReclassifiable(projectId: string): Promise<ReclassifiableEntry[]>;
  findSummariesToRebuild(projectId: string | null): Promise<SummarizableEntry[]>;
  retype(id: string, change: { type: ContextEntryType; summary: string | null; metadata: Record<string, unknown> }): Promise<void>;
  updateSummary(id: string, summary: string): Promise<void>;
}
