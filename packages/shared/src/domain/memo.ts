import { z } from "zod";
import { sourceType } from "./source.js";

/** Kind of knowledge unit. Section 14, context_entries.type */
export const contextEntryType = z.enum([
  "decision",
  "constraint",
  "incident",
  "architecture",
  "technical_debt",
  "convention",
  "business_rule",
  "integration_note",
  "risk",
  "how_to",
  "meeting_summary",
  "pr_summary",
  "ticket_resolution",
  "other",
]);
export type ContextEntryType = z.infer<typeof contextEntryType>;

const RENAMED_TYPES = new Map<string, ContextEntryType>([["module_note", "other"]]);

export const contextEntryTypeInput = z.preprocess(
  (value) => (typeof value === "string" ? (RENAMED_TYPES.get(value) ?? value) : value),
  contextEntryType,
);

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

export const entrySortField = z.enum(["created", "updated"]);
export type EntrySortField = z.infer<typeof entrySortField>;

export const sortDirection = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof sortDirection>;

/** Confidence level in the information. Section 14, confidence */
export const confidenceLevel = z.enum(["low", "medium", "high", "verified"]);
export type ConfidenceLevel = z.infer<typeof confidenceLevel>;

/**
 * Whether the knowledge still holds. Section 14 lists `validity` without enumerating
 * values; this minimal set is a proposal, up for review.
 */
export const validity = z.enum(["current", "historical", "unknown"]);
export type Validity = z.infer<typeof validity>;

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
  type: contextEntryTypeInput.optional(),
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
  type: contextEntryTypeInput.optional(),
  limit: z.number().int().positive().max(50).default(10),
});
export type SearchContextInput = z.infer<typeof searchContextInput>;
