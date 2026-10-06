import type { ConfidenceLevel, ContextEntryStatus, ContextEntryType, SourceType } from "@cortex/shared";
import { canonicalize, classifyType, deriveTitle, extractEntities, stripLeadingTitle, summarize } from "../../text.js";
import type { EntityType } from "../../graph/domain/entity.js";

export type MemoType = ContextEntryType;
export type MemoStatus = ContextEntryStatus;
export type Validity = "current" | "historical" | "unknown";

/** A memo is one piece of the memory (ADR-0077). The contract pins only what a client reads of it (ADR-0086). */
export interface Memo {
  id: string;
  projectId: string | null;
  clientId: string | null;
  title: string;
  content: string;
  summary: string | null;
  type: MemoType;
  status: MemoStatus;
  confidence: ConfidenceLevel;
  validity: Validity;
  sourceType: SourceType;
  sourceReference: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  supersededBy: string | null;
  metadata: Record<string, unknown>;
  validFrom: Date;
  validTo: Date | null;
  observedAt: Date;
}

/**
 * The `Memo` aggregate in its creation state: the rules that turn a piece of knowledge into a
 * memo live here, away from the SQL and the classifier (ADR-0076). The caller scrubs first -- a
 * secret never reaches the classifier or the embedding -- and classifies second; this only
 * resolves what the memo becomes.
 */

export interface ClassifierResult {
  type?: MemoType;
  title?: string;
  summary?: string;
  entities?: { name: string; type: EntityType }[];
}

export interface DraftInput {
  /** Already scrubbed: the aggregate never sees unscrubbed text. */
  content: string;
  /** Already scrubbed. */
  title?: string;
  type?: MemoType;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export class MemoDraft {
  readonly content: string;
  readonly title: string;
  readonly summary: string;
  readonly type: MemoType;
  readonly entities: { name: string; type: EntityType }[];
  readonly enrichedBy: string;

  private constructor(input: DraftInput, llm: ClassifierResult | null) {
    // Precedence: explicit input > LLM > heuristic.
    this.content = input.content;
    this.type = input.type ?? llm?.type ?? classifyType(input.content);
    this.title = input.title ?? llm?.title ?? deriveTitle(input.content);
    // The summary sits right below the title in the pack and in the cards, so starting with the
    // title spends budget on saying the same thing twice (ADR-0054).
    this.summary = stripLeadingTitle(input.summary ?? llm?.summary ?? summarize(input.content), this.title);
    this.entities = mergeEntities(extractEntities(input.content), llm?.entities ?? []);
    this.enrichedBy = llm ? "llm" : ((input.metadata?.enrichedBy as string | undefined) ?? "heuristic");
  }

  static from(input: DraftInput, llm: ClassifierResult | null): MemoDraft {
    return new MemoDraft(input, llm);
  }

  /** The title over the content, so the title weighs in retrieval. */
  get embedText(): string {
    return `${this.title}\n\n${this.content}`;
  }
}

function mergeEntities(
  ...lists: { name: string; type: EntityType }[][]
): { name: string; type: EntityType }[] {
  const byKey = new Map<string, { name: string; type: EntityType }>();
  for (const list of lists) {
    for (const e of list) {
      // A project is created, not extracted: wherever it comes from, it does not get in (#135).
      if (e.type === "project") continue;
      const key = `${e.type}:${canonicalize(e.name)}`;
      if (!byKey.has(key)) byKey.set(key, e);
    }
  }
  return [...byKey.values()];
}

export type ReclassifyDecision = "retype" | "confirmed" | "unclassified";

/**
 * Whether reclassification WRITES to a memo. Only a type that really changes is worth an
 * UPDATE: storing the type the memo already had moves `updated_at` through the
 * `set_updated_at` trigger, and a movement there reads downstream as "something happened to
 * this memo" -- which is how auto-curation came to promote nearly every distilled memo in the
 * same maintenance pass (ADR-0067).
 */
export function decideReclassification(
  current: MemoType,
  proposed: MemoType | null | undefined,
): ReclassifyDecision {
  if (!proposed) return "unclassified";
  return proposed === current ? "confirmed" : "retype";
}
