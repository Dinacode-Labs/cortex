import { z } from "zod";
import { sourceType } from "./source.js";

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

export const confidenceLevel = z.enum(["low", "medium", "high", "verified"]);
export type ConfidenceLevel = z.infer<typeof confidenceLevel>;

export const saveContextInput = z.object({
  content: z.string().min(1, "content cannot be empty"),
  project: z.string().min(1).optional().describe("Project slug (what `cortex link` shows) or name; a new project is created if neither matches"),
  title: z.string().optional(),
  type: contextEntryTypeInput.optional(),
  summary: z.string().optional(),
  confidence: confidenceLevel.optional(),
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  createdBy: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type SaveContextInput = z.infer<typeof saveContextInput>;

export const searchContextInput = z.object({
  query: z.string().min(1),
  project: z.string().optional().describe("Project slug (what `cortex link` shows) or name"),
  type: contextEntryTypeInput.optional(),
  limit: z.number().int().positive().max(50).default(10),
});
export type SearchContextInput = z.infer<typeof searchContextInput>;
