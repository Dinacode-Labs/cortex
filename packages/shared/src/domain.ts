import { z } from "zod";

/**
 * Cortex domain model.
 *
 * It mirrors the hypothetical data model in section 14 of the founding document. It is a
 * minimal proposal for the demo and should be questioned (see docs/decisions.md).
 *
 * Enums are defined as zod schemas (the source of truth for validation in MCP and Mastra)
 * and the TypeScript types are derived with z.infer.
 */

/** Kind of knowledge unit. Section 14, context_entries.type */
export const contextEntryType = z.enum([
  "decision",
  "constraint",
  "incident",
  "architecture",
  "module_note",
  "technical_debt",
  "convention",
  "business_rule",
  "integration_note",
  "risk",
  "how_to",
  "meeting_summary",
  "pr_summary",
  "ticket_resolution",
]);
export type ContextEntryType = z.infer<typeof contextEntryType>;

/** Lifecycle state of an entry. Section 14, context_entries.status */
export const contextEntryStatus = z.enum([
  "draft",
  "pending_validation",
  "validated",
  "rejected",
  "obsolete",
  "superseded",
]);
export type ContextEntryStatus = z.infer<typeof contextEntryStatus>;

/** Confidence level in the information. Section 14, confidence */
export const confidenceLevel = z.enum(["low", "medium", "high", "verified"]);
export type ConfidenceLevel = z.infer<typeof confidenceLevel>;

/**
 * Whether the knowledge still holds. Section 14 lists `validity` without enumerating
 * values; this minimal set is a proposal, up for review.
 */
export const validity = z.enum(["current", "historical", "unknown"]);
export type Validity = z.infer<typeof validity>;

/**
 * Entity type in the relational graph. Section 14, entities.type
 *
 * An entity is a **thing that has a name** -- a module, a service, a technology, a client --
 * not a claim about the project. This enum used to include `decision` and `incident`, which
 * are ENTRY types, and the result was a shadow graph: the same decision stored twice, once
 * as an entry and once as a node whose name was the whole sentence. One real installation
 * had 222 nodes like that, with names such as "Publish Cortex openly and monetise the
 * implementation". They polluted the orphan list, the map and -- above all -- the
 * contradictions, which came out between node names instead of between entries. See ADR-0055.
 */
export const entityType = z.enum([
  "client",
  "project",
  "repository",
  "module",
  "service",
  "technology",
  "person",
  "integration",
  "vendor",
]);
export type EntityType = z.infer<typeof entityType>;

/**
 * The types OFFERED to the extractor (classifier and graph). `project` is absent: a project
 * is the container of the memory and is born through `createProject` -- with a slug and an
 * owner -- not from a proper noun the LLM read as a project. While it was offered, every
 * ticket, branch or microservice mentioned ended up in `entities` with `type='project'`: the
 * same row as a real project, and it showed up in `cortex link` and in the UI as such (#135).
 * Same pattern as ADR-0055 with `decision`/`incident`, but here the type is legitimate, so
 * it is removed from what gets extracted, not from the enum.
 */
export const extractableEntityType = z.enum(
  entityType.options.filter((t) => t !== "project") as [Exclude<EntityType, "project">, ...Exclude<EntityType, "project">[]],
);
export type ExtractableEntityType = z.infer<typeof extractableEntityType>;

/**
 * Whether a name works as a graph entity.
 *
 * Entities are names, not sentences. The extractor used to return things like "opcion C",
 * "Do not assume source paths in the target" or "package", which then showed up as orphans
 * and paired with each other in the contradiction report. A report that is half noise teaches
 * people not to look at it, so the bar is set here: if it does not look like the proper name
 * of something in the domain, it does not get in.
 */
export function isUsableEntityName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 60) return false;
  if (n.split(/\s+/).length > 6) return false; // a sentence, not a name
  if (/[.;]$/.test(n) || n.includes(": ")) return false;
  // Spanish on purpose: this matches the corpus, not our source. Deictics -- "opcion C",
  // "la opcion a", "v3", "caso 2" -- name nothing on their own. Add a language here only
  // when a corpus in that language is actually being ingested.
  if (/^(la |el |una? )?(opci[oó]n|alternativa|caso|punto|paso|fase|v)\s*\d*[a-z]?$/i.test(n)) return false;
  return /[a-zA-Z]/.test(n);
}

/** Relation type between entities or entries. Section 14, relations.relation_type */
export const relationType = z.enum([
  "belongs_to",
  "affects",
  "depends_on",
  "contradicts",
  "supersedes",
  "related_to",
  "implemented_by",
  "discussed_in",
  "caused_by",
  "resolved_by",
]);
export type RelationType = z.infer<typeof relationType>;

/** Where a piece of knowledge came from. Section 14, sources.source_type */
export const sourceType = z.enum([
  "manual",
  "claude_code",
  "github_pr",
  "github_issue",
  "jira_ticket",
  "notion_doc",
  "email",
  "chat",
  "meeting_transcript",
  "codex",
  "agent_session",
  "document",
]);
export type SourceType = z.infer<typeof sourceType>;

/** A unit of knowledge. Section 14, context_entries */
export const contextEntry = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  clientId: z.string().uuid().nullable(),
  title: z.string(),
  content: z.string(),
  summary: z.string().nullable(),
  type: contextEntryType,
  status: contextEntryStatus,
  confidence: confidenceLevel,
  validity: validity,
  sourceType: sourceType,
  sourceReference: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  supersededBy: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  // Bi-temporality: the fact's validity window. validTo null = still current.
  validFrom: z.date(),
  validTo: z.date().nullable(),
  observedAt: z.date(),
});
export type ContextEntry = z.infer<typeof contextEntry>;

/** An entity in the relational graph. Section 14, entities */
export const entity = z.object({
  id: z.string().uuid(),
  name: z.string(),
  canonicalName: z.string(),
  type: entityType,
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Entity = z.infer<typeof entity>;

/** A relation between entities/entries. Section 14, relations */
export const relation = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: z.string(),
  targetId: z.string().uuid(),
  targetType: z.string(),
  relationType: relationType,
  confidence: confidenceLevel,
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
});
export type Relation = z.infer<typeof relation>;

/** The original source of an entry. Section 14, sources */
export const source = z.object({
  id: z.string().uuid(),
  sourceType: sourceType,
  externalId: z.string().nullable(),
  url: z.string().nullable(),
  rawContent: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
});
export type Source = z.infer<typeof source>;

/**
 * Minimal input for saving context. Used both by manual capture and by Claude Code (the
 * save_project_context MCP tool). Designed for low friction: only `content` is required;
 * Cortex fills in and classifies the rest (section 5.2).
 */
export const saveContextInput = z.object({
  content: z.string().min(1, "content cannot be empty"),
  /** Project slug or name. Resolved to a `project` entity; created if it does not exist. */
  project: z.string().min(1).optional().describe("Project slug (what `cortex link` shows) or name; a new project is created if neither matches"),
  /** Optional short title; derived from the content when missing. */
  title: z.string().optional(),
  /** Knowledge type; proposed by the classifier agent when missing. */
  type: contextEntryType.optional(),
  /** Optional precomputed summary (e.g. from a workflow); derived when missing. */
  summary: z.string().optional(),
  confidence: confidenceLevel.optional(),
  /** Where it comes from. Defaults to "manual". */
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  createdBy: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type SaveContextInput = z.infer<typeof saveContextInput>;

/** Context search parameters (the search_project_context MCP tool). */
export const searchContextInput = z.object({
  query: z.string().min(1),
  project: z.string().optional().describe("Project slug (what `cortex link` shows) or name"),
  type: contextEntryType.optional(),
  limit: z.number().int().positive().max(50).default(10),
});
export type SearchContextInput = z.infer<typeof searchContextInput>;
