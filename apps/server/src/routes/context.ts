import { Hono } from "hono";
import { z } from "zod";
import {
  captureBatch,
  checkEntryAccess,
  checkProjectAccess,
  getContextPack,
  getEntryDetail,
  NotAManagerError,
  purgeEntries,
  relateEntries,
  renderContextPack,
  saveWithReconciliation,
  searchContext,
  updateEntryFields,
} from "@cortex/core";
import {
  confidenceLevel,
  contextEntryType,
  purgeEntriesRequest,
  relationType,
  sourceType,
  updateEntryRequest,
  type PurgeEntriesResponse,
} from "@cortex/shared";
import { currentUser } from "../auth-helpers.js";
import { parseBody } from "../validate.js";

/**
 * Authenticated context routes (they replace the direct database access hooks and connectors
 * used to have): writes are attributed to the user (created_by = email) and respect
 * permissions. Unhandled errors bubble up to app.ts's onError.
 */
export const contextRoutes = new Hono();

// The enums come from @cortex/shared: the values the real connectors send (document,
// github_pr/github_issue, notion_doc, meeting_transcript, agent_session;
// pr_summary/ticket_resolution/incident; belongs_to) are all inside the enum.
// Fields previously tolerated as optional remain optional.

const captureSchema = z.object({
  slug: z.string().min(1),
  content: z.string().min(1),
  title: z.string().optional(),
  type: contextEntryType.optional(),
  confidence: confidenceLevel.optional(),
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  metadata: z.record(z.unknown()).optional(), // an open record, as it has always been
});

// The same shape as @cortex/core's BatchItem (typed there as loose strings).
const batchItemSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1),
  type: contextEntryType.optional(),
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  confidence: confidenceLevel.optional(),
  metadata: z.record(z.unknown()).optional(),
});

const captureBatchSchema = z.object({
  slug: z.string().min(1),
  items: z.array(batchItemSchema),
});

const relateSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationType: relationType,
});

/** Context injection (the SessionStart hook): the linked project's pack, access permitting. */
contextRoutes.get("/context-pack", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const slug = c.req.query("slug") ?? "";
  if (!slug) return c.json({ error: "Project not found." }, 404);
  const access = await checkProjectAccess(user.email, { slug });
  if (access.status === "not_found") return c.json({ error: "Project not found." }, 404);
  if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  const project = access.project;
  try {
    // The consumer says how much fits; trimming here shares the room out between sections
    // instead of cutting the pack wherever it lands. Bounded, so nobody asks for an absurd pack.
    const asked = Number(c.req.query("maxChars") ?? "");
    const maxChars = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 200_000) : undefined;
    const text = renderContextPack(await getContextPack(project.name), { maxChars });
    return c.json({ project: project.name, text });
  } catch (e) {
    // ONLY the guard-to-query race: the project can disappear or be renamed between
    // checkProjectAccess and getContextPack ("Project not found: ..."). In that case we keep
    // the hook's contract (an empty pack, the session does not break). Any other error bubbles
    // up to app.ts's onError (this used to swallow EVERYTHING).
    if (e instanceof Error && e.message.startsWith("Project not found")) {
      return c.json({ project: project.name, text: "" });
    }
    throw e;
  }
});

/** Authenticated capture (the SessionEnd hook / connectors): it stores with reconciliation
 *  and attribution (created_by = email). It respects the project's permissions. */
contextRoutes.post("/capture", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, captureSchema);
  if (body instanceof Response) return body;
  const access = await checkProjectAccess(user.email, { slug: body.slug });
  if (access.status === "not_found") return c.json({ error: "Project not found." }, 404);
  if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  const project = access.project;
  // No try/catch: an internal failure bubbles up to onError (a generic 500; the internal
  // message no longer leaks to the client -- the connectors only look at r.ok).
  const r = await saveWithReconciliation(
    {
      content: body.content,
      project: project.name,
      title: body.title,
      type: body.type,
      confidence: body.confidence ?? "low",
      sourceType: body.sourceType ?? "manual",
      sourceReference: body.sourceReference,
      createdBy: user.email,
      metadata: body.metadata,
    },
    { useClassifier: false, detectImprovements: false, skipEmbedding: false },
  );
  return c.json(r);
});

/** BATCH capture (connectors): N items, batched embedding, attribution. */
contextRoutes.post("/capture/batch", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, captureBatchSchema);
  if (body instanceof Response) return body;
  const access = await checkProjectAccess(user.email, { slug: body.slug });
  if (access.status === "not_found") return c.json({ error: "Project not found." }, 404);
  if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  const project = access.project;
  const results = await captureBatch(project.name, body.items, user.email);
  return c.json({ results });
});

/** A relation between entries (e.g. an attachment belongs_to its page). Authenticated. */
contextRoutes.post("/relate", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, relateSchema);
  if (body instanceof Response) return body;
  // Permission per entry (not by project name): BOTH must be accessible.
  // An entry with no project is allowed (there are no permissions to apply).
  for (const eid of [body.sourceId, body.targetId]) {
    const access = await checkEntryAccess(user.email, eid);
    if (access.status === "not_found") return c.json({ error: "Entry not found." }, 404);
    if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  }
  await relateEntries(body.sourceId, body.targetId, body.relationType);
  return c.json({ ok: true });
});

/**
 * The ids are UUIDs and arrive from outside (an agent will invent one before asking). Without
 * this check, a malformed id reaches Postgres and comes back as a 500: it is user input, not a
 * server fault, so the answer is the same as for an id that does not exist.
 */
const ES_UUID = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// The API could write but not read: search only existed over MCP, against the database. That
// left out the CLI and the memory tools Cortex registers in Pi (ADR-0034).

/** Hybrid search. Without `slug`, over everything the user can see; with one, in that project. */
contextRoutes.get("/search", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);

  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ error: "Missing query: pass ?q=" }, 400);
  const tipo = contextEntryType.safeParse(c.req.query("type"));
  const limiteCrudo = Number(c.req.query("limit") ?? "10");
  const limit = Number.isFinite(limiteCrudo) ? Math.min(Math.max(Math.trunc(limiteCrudo), 1), 50) : 10;

  const slug = c.req.query("slug");
  let project: string | undefined;
  if (slug) {
    const access = await checkProjectAccess(user.email, { slug });
    if (access.status === "not_found") return c.json({ error: "Project not found." }, 404);
    if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
    project = access.project.name;
  }

  // With no concrete project it must be scoped to what is accessible: otherwise global search
  // would be a way to read other people's private projects.
  const hits = await searchContext(
    { query: q, project, type: tipo.success ? tipo.data : undefined, limit },
    project ? undefined : { restrictToAccessibleOf: user.email },
  );

  return c.json({
    hits: hits.map((h) => ({
      id: h.entry.id,
      title: h.entry.title ?? "",
      content: h.entry.content,
      type: h.entry.type,
      projectId: h.entry.projectId ?? null,
      confidence: h.entry.confidence ?? null,
      status: h.entry.status ?? null,
      score: h.score ?? null,
    })),
  });
});

/** One entry, with its provenance. Permission PER ENTRY, not by project name. */
contextRoutes.get("/entries/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const id = c.req.param("id");
  if (!ES_UUID(id)) return c.json({ error: "Entry not found." }, 404);
  const access = await checkEntryAccess(user.email, id);
  if (access.status === "not_found") return c.json({ error: "Entry not found." }, 404);
  if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  const detail = await getEntryDetail(id);
  if (!detail) return c.json({ error: "Entry not found." }, 404); // a race between the guard and the query
  return c.json(detail);
});

/** Correcting an entry (title and/or content). It is how an agent fixes what it stored badly. */
contextRoutes.patch("/entries/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const id = c.req.param("id");
  if (!ES_UUID(id)) return c.json({ error: "Entry not found." }, 404);
  const body = await parseBody(c, updateEntryRequest);
  if (body instanceof Response) return body;
  const access = await checkEntryAccess(user.email, id);
  if (access.status === "not_found") return c.json({ error: "Entry not found." }, 404);
  if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  const ok = await updateEntryFields(id, body);
  if (!ok) return c.json({ error: "Entry not found." }, 404);
  return c.json({ ok: true, id });
});

/**
 * Purging entries for good (ADR-0072). Reading the entry is not enough: it takes managing the
 * project of every one of them, and a single id that is missing, unreadable or not the
 * caller's to manage purges none.
 */
contextRoutes.post("/entries/purge", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, purgeEntriesRequest);
  if (body instanceof Response) return body;
  const missing: string[] = [];
  for (const id of body.ids) {
    const access = await checkEntryAccess(user.email, id);
    if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
    if (access.status === "not_found") missing.push(id);
  }
  if (missing.length) return c.json({ error: "Entry not found.", missing }, 404);
  try {
    const result: PurgeEntriesResponse = await purgeEntries(body.ids, user.email);
    return c.json(result);
  } catch (e) {
    if (e instanceof NotAManagerError) return c.json({ error: e.message }, 403);
    throw e;
  }
});
