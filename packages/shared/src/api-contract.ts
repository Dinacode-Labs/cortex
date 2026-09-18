import { z } from "zod";
import { confidenceLevel, contextEntryType, sourceType } from "./domain.js";

/**
 * The HTTP API contract: the schemas server and client share.
 *
 * They live in `shared` rather than in the server or the client because both need them, and
 * keeping them in one place is what stops them drifting apart silently: the server validates
 * the body with the very schema the client used to build it.
 *
 * zod v3 (the one the rest of the repo uses; `agents` uses v4 because Mastra requires it,
 * isolated -- ADR-0008).
 */

// --- Configuration the server announces to its clients --------------------------------

export const clientConfig = z.object({
  /** API base (it may carry a path prefix when there is a proxy in front). */
  apiUrl: z.string(),
  /** The MCP-over-HTTP URL, so the CLI does not have to guess it. */
  mcpUrl: z.string(),
  webUrl: z.string(),
  /** Server version. Informational only: the CLI compares it with its own to warn. */
  version: z.string(),
  /** Minimum CLI version this server accepts; below it, the CLI refuses to write (ADR-0062). */
  minClientVersion: z.string(),
});
export type ClientConfig = z.infer<typeof clientConfig>;

// --- Projects -------------------------------------------------------------------------

export const projectSummary = z.object({
  slug: z.string(),
  name: z.string(),
  visibility: z.enum(["public", "private"]),
});
export type ProjectSummary = z.infer<typeof projectSummary>;

/**
 * What a project can change after birth (ADR-0051). Both fields are optional and only
 * applied when present: sending `{}` does not clear the owner. Removing it has to be said
 * with `ownerEmail: null`, which is a different decision from not mentioning it.
 */
export const updateProjectRequest = z.object({
  visibility: z.enum(["public", "private"]).optional(),
  ownerEmail: z.string().email().nullable().optional(),
  /** Hang it under another project, or `null` to leave it standalone. */
  parentSlug: z.string().nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequest>;

export const projectMemberRequest = z.object({ email: z.string().email() });
export type ProjectMemberRequest = z.infer<typeof projectMemberRequest>;

export const createProjectRequest = z.object({
  name: z.string().min(1).max(120),
  visibility: z.enum(["public", "private"]).optional(),
  /** Hangs the project under another one (it inherits context and permissions). */
  parentSlug: z.string().optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequest>;

export const createProjectResponse = z.object({
  project: projectSummary,
  /** false = it already existed and you have access; no duplicate is created. */
  created: z.boolean(),
});
export type CreateProjectResponse = z.infer<typeof createProjectResponse>;

// --- Capture of an agent session ------------------------------------------------------

export const capturePlatform = z.enum(["claude", "codex", "opencode", "hermes", "pi", "meeting", "other"]);
export type CapturePlatform = z.infer<typeof capturePlatform>;

/**
 * The client sends the transcript already **condensed and scrubbed**; distilling is the
 * server's job, since it is the one holding the model credentials (ADR-0025).
 */
export const captureSessionRequest = z.object({
  slug: z.string().min(1),
  platform: capturePlatform,
  sessionId: z.string().min(1).max(200),
  condensed: z.string().min(1),
  sourceType: sourceType.optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CaptureSessionRequest = z.infer<typeof captureSessionRequest>;

export const captureSessionCounters = z.object({
  saved: z.number(),
  updated: z.number(),
  superseded: z.number(),
  noop: z.number(),
  failed: z.number(),
  windows: z.number(),
  /**
   * Characters of the session left undistilled, when it did not fit whole. Optional because
   * captures predating this do not have it: its absence means "unknown", not "zero".
   */
  droppedChars: z.number().optional(),
});
export type CaptureSessionCounters = z.infer<typeof captureSessionCounters>;

export const captureSessionResponse = z.object({
  id: z.string(),
  /** `duplicate` = this session was already distilled with the same content; no repeat spend. */
  status: z.enum(["queued", "running", "done", "failed", "duplicate"]),
  counters: captureSessionCounters.optional(),
  error: z.string().optional(),
});
export type CaptureSessionResponse = z.infer<typeof captureSessionResponse>;

// --- One-off capture (a single piece of knowledge) ------------------------------------

export const captureRequest = z.object({
  slug: z.string().min(1),
  content: z.string().min(1),
  title: z.string().optional(),
  type: contextEntryType.optional(),
  confidence: confidenceLevel.optional(),
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CaptureRequest = z.infer<typeof captureRequest>;

// --- Batch capture (connectors) -------------------------------------------------------

/**
 * One item of `POST /capture/batch`. The enum-ish fields are typed as `string` on purpose:
 * connectors build items from external sources and the server is what validates against the
 * domain enums. That way a connector never needs to import `core`.
 */
export interface BatchItem {
  title?: string;
  content: string;
  type?: string;
  sourceType?: string;
  sourceReference?: string;
  confidence?: string;
  metadata?: Record<string, unknown>;
}

// --- Search and access by id ----------------------------------------------------------
//
// The API could write (`/capture`) but not read: search only existed over MCP, against the
// database. That left out the CLI and any integration that is not an MCP-speaking agent,
// such as the memory tools Cortex registers in Pi (ADR-0034).

export const searchRequest = z.object({
  q: z.string().min(1),
  /** Without a slug it searches everything accessible; with one, only that project. */
  slug: z.string().optional(),
  type: contextEntryType.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type SearchRequest = z.infer<typeof searchRequest>;

export const searchHitSummary = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  type: z.string(),
  projectId: z.string().nullable(),
  confidence: z.string().nullable(),
  status: z.string().nullable(),
  score: z.number().nullable(),
});
export type SearchHitSummary = z.infer<typeof searchHitSummary>;

export const searchResponse = z.object({ hits: z.array(searchHitSummary) });
export type SearchResponse = z.infer<typeof searchResponse>;

/**
 * Updating an entry by id. Only `title` and `content`: the rest (type, confidence, validity)
 * is decided by reconciliation or by the lint, not by whoever calls the API. Changing the
 * content recomputes the embedding, so the entry stays findable.
 */
export const updateEntryRequest = z
  .object({ title: z.string().min(1).optional(), content: z.string().min(1).optional() })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: "Nothing to update: pass title, content, or both.",
  });
export type UpdateEntryRequest = z.infer<typeof updateEntryRequest>;

/**
 * `GET /entries/:id` returns core's `EntryDetail` as is. The client does not need to know
 * its whole shape -- it uses it for display -- so only what is actually read by code is
 * pinned here; the rest travels along anyway.
 */
export interface EntryDetailResponse {
  entry: { id: string; title?: string | null; content: string; type: string; status?: string | null; confidence?: string | null };
  [k: string]: unknown;
}
