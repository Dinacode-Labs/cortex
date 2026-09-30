import type { ContextEntryType, EntityType } from "@cortex/shared";
import { canonicalize, classifyType, deriveTitle, extractEntities, stripLeadingTitle, summarize } from "../../text.js";

/**
 * The `ContextEntry` aggregate in its creation state: the rules that turn a piece of knowledge
 * into an entry live here, away from the SQL and the classifier (ADR-0076). The caller scrubs
 * first -- a secret never reaches the classifier or the embedding -- and classifies second;
 * this only resolves what the entry becomes.
 */

export interface ClassifierResult {
  type?: ContextEntryType;
  title?: string;
  summary?: string;
  entities?: { name: string; type: EntityType }[];
}

export interface DraftInput {
  /** Already scrubbed: the aggregate never sees unscrubbed text. */
  content: string;
  /** Already scrubbed. */
  title?: string;
  type?: ContextEntryType;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export class ContextEntryDraft {
  readonly content: string;
  readonly title: string;
  readonly summary: string;
  readonly type: ContextEntryType;
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

  static from(input: DraftInput, llm: ClassifierResult | null): ContextEntryDraft {
    return new ContextEntryDraft(input, llm);
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
 * Whether reclassification WRITES to an entry. Only a type that really changes is worth an
 * UPDATE: storing the type the entry already had moves `updated_at` through the
 * `set_updated_at` trigger, and a movement there reads downstream as "something happened to
 * this entry" -- which is how auto-curation came to promote nearly every distilled entry in the
 * same maintenance pass (ADR-0067).
 */
export function decideReclassification(
  current: ContextEntryType,
  proposed: ContextEntryType | null | undefined,
): ReclassifyDecision {
  if (!proposed) return "unclassified";
  return proposed === current ? "confirmed" : "retype";
}
