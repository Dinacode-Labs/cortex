import { getSql, type Sql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  type ContextEntry,
  type ContextEntryType,
  type EntityType,
  type SaveContextInput,
  saveContextInput,
  scrub,
} from "@cortex/shared";
import { linkEntryToEntity, relate, resolveEntity } from "./entities.js";
import { rowToContextEntry, type Row } from "./map.js";
import { createProject, findProjectIdByName } from "./projects.js";
import {
  canonicalize,
  classifyType,
  deriveTitle,
  extractEntities,
  isDerivedSummary,
  polarityContradicts,
  polarityTags,
  stripLeadingTitle,
  summarize,
} from "./text.js";
import { storeEmbedding, vectorSearch } from "./vectors.js";

// --- Optional classification hook (the LLM layer) ----------------------------

export interface ClassifierResult {
  type?: ContextEntryType;
  title?: string;
  summary?: string;
  entities?: { name: string; type: EntityType }[];
}

/** LLM enrichment function. It returns null when it cannot classify. */
export type Classifier = (content: string) => Promise<ClassifierResult | null>;

let classifier: Classifier | null = null;

/**
 * Registers (or, with null, unregisters) an LLM classifier. The entrypoints (mcp-server, web)
 * wire it when an LLM is available, which keeps @cortex/core decoupled from
 * Mastra/@cortex/agents. With no classifier, the heuristics are used.
 */
export function setClassifier(fn: Classifier | null): void {
  classifier = fn;
}

// --- save_project_context ----------------------------------------------------

export interface ContextWarning {
  kind: "possible_duplicate" | "possible_contradiction";
  message: string;
  relatedEntryId: string;
  relatedTitle: string;
  score: number;
}

export interface SaveContextResult {
  entry: ContextEntry;
  /** Signals from the improvement loop (duplicates/contradictions). Sections 12.1 and 12.5. */
  warnings: ContextWarning[];
}

/**
 * Stores a piece of context with low friction: it classifies, summarises, extracts entities,
 * generates the embedding and runs the detection loops. Sections 11 and 15.2.
 */
export interface SaveContextOptions {
  /** When false, the LLM classifier is not invoked (the workflow uses this: it classifies in
   *  an earlier step and passes explicit type/title/summary). Defaults to true. */
  useClassifier?: boolean;
  /** When false, the duplicate/contradiction loops are skipped (bulk ingestion).
   *  Defaults to true. */
  detectImprovements?: boolean;
  /** When true, the embedding is not generated here (ingestion does them in batches later). */
  skipEmbedding?: boolean;
}

export async function saveContext(
  input: SaveContextInput,
  opts: SaveContextOptions = {},
): Promise<SaveContextResult> {
  const raw = saveContextInput.parse(input);
  // Last line of defence: the server does NOT trust that the client scrubbed (the hooks and
  // connectors do, but the API is open to any authenticated client). It is cleaned BEFORE
  // classifying with the LLM, generating the embedding and persisting, so none of those three
  // paths ever sees the secret.
  const parsed = {
    ...raw,
    content: scrub(raw.content),
    title: raw.title ? scrub(raw.title) : raw.title,
  };
  const sql = getSql();
  const provider = getEmbeddingProvider();

  // Optional LLM layer: precedence is explicit input > LLM > heuristic.
  const useClassifier = opts.useClassifier ?? true;
  const llm = useClassifier && classifier ? await classifier(parsed.content).catch(() => null) : null;
  const type = parsed.type ?? llm?.type ?? classifyType(parsed.content);
  const title = parsed.title ?? llm?.title ?? deriveTitle(parsed.content);
  // The summary sits right below the title in the pack and in the cards, so starting with the
  // title spends budget on saying the same thing twice (ADR-0054).
  const summary = stripLeadingTitle(parsed.summary ?? llm?.summary ?? summarize(parsed.content), title);
  const sourceType = parsed.sourceType ?? "manual";
  const embedText = `${title}\n\n${parsed.content}`;
  // metadata is zod-validated JSON; it is cast to the type sql.json expects.
  const enrichedBy = llm ? "llm" : ((parsed.metadata?.enrichedBy as string | undefined) ?? "heuristic");
  const meta = {
    ...(parsed.metadata ?? {}),
    enrichedBy,
  } as Parameters<typeof sql.json>[0];

  // Entities: the heuristic ones plus whatever the LLM detects, deduplicated.
  const detectedEntities = mergeEntities(extractEntities(parsed.content), llm?.entities ?? []);

  let projectId: string | null = null;
  if (parsed.project) {
    // A project born from a `save` goes through the same place as `cortex link --create`: with
    // a slug and an owner (ADR-0051). It used to be created with `resolveEntity`, which only
    // sets the name, and ended up with no slug, no owner and public: impossible to link, to
    // adopt or to close. `createProject` returns an existing one untouched, so this changes
    // nothing about the projects already there.
    projectId = (await createProject(parsed.project, { ownerEmail: parsed.createdBy ?? null })).id;
  }

  const sourceRows = (await sql`
    INSERT INTO sources (source_type, raw_content, metadata)
    VALUES (${sourceType}, ${parsed.content}, ${sql.json(meta)})
    RETURNING id
  `) as unknown as Row[];
  const sourceId = sourceRows[0]!.id as string;

  const entryRows = (await sql`
    INSERT INTO context_entries
      (project_id, source_id, title, content, summary, type, confidence,
       source_type, source_reference, created_by, metadata)
    VALUES (${projectId}, ${sourceId}, ${title}, ${parsed.content}, ${summary}, ${type},
            ${parsed.confidence ?? "medium"}, ${sourceType}, ${parsed.sourceReference ?? null},
            ${parsed.createdBy ?? null}, ${sql.json(meta)})
    RETURNING *
  `) as unknown as Row[];
  const entry = rowToContextEntry(entryRows[0]!);

  if (!opts.skipEmbedding) await storeEmbedding(sql, provider, entry.id, embedText);

  // Entity linking (the relational graph)
  const entityIds: string[] = [];
  for (const e of detectedEntities) {
    const ent = await resolveEntity(sql, e.name, e.type);
    entityIds.push(ent.id);
    await linkEntryToEntity(sql, entry.id, ent.id);
    if (projectId) {
      await relate(sql, {
        sourceId: ent.id,
        sourceType: "entity",
        targetId: projectId,
        targetType: "entity",
        relationType: "belongs_to",
      });
    }
  }
  if (projectId) await linkEntryToEntity(sql, entry.id, projectId);

  const warnings =
    (opts.detectImprovements ?? true)
      ? await detectImprovements(sql, entry, projectId, embedText, entityIds)
      : [];
  return { entry, warnings };
}

/**
 * Improvement loops (sections 12.1 and 12.5):
 *  - Duplicate: very high vector similarity with an existing entry.
 *  - Contradiction: opposite polarity (e.g. "keep" vs "remove") about the same subject,
 *    detected through shared entities. It does not rely on high vector similarity, which with
 *    local lexical embeddings would be unreliable.
 */
async function detectImprovements(
  sql: Sql,
  entry: ContextEntry,
  projectId: string | null,
  embedText: string,
  entityIds: string[],
): Promise<ContextWarning[]> {
  const provider = getEmbeddingProvider();
  const warnings: ContextWarning[] = [];
  const seen = new Set<string>();
  const newPolarity = polarityTags(entry.content);

  // Duplicates by vector similarity.
  const hits = await vectorSearch(sql, provider, {
    queryText: embedText,
    projectId,
    limit: 6,
    excludeId: entry.id,
  });
  const scoreById = new Map(hits.map((h) => [h.entry.id, h.score]));
  for (const hit of hits) {
    if (hit.score >= 0.85 && !seen.has(hit.entry.id)) {
      seen.add(hit.entry.id);
      warnings.push({
        kind: "possible_duplicate",
        message: `Possible duplicate of "${hit.entry.title}" (similarity ${hit.score.toFixed(2)}). Consider consolidating.`,
        relatedEntryId: hit.entry.id,
        relatedTitle: hit.entry.title,
        score: hit.score,
      });
    }
  }

  // Contradictions by opposite polarity over shared entities.
  if (newPolarity.size > 0 && entityIds.length > 0) {
    const candidates = (await sql`
      SELECT DISTINCT ce.*
      FROM context_entries ce
      JOIN context_entry_entities cee ON cee.context_entry_id = ce.id
      WHERE cee.entity_id IN ${sql(entityIds)}
        AND ce.id <> ${entry.id}
        AND ce.status NOT IN ('rejected', 'obsolete')
    `) as unknown as Row[];
    for (const row of candidates) {
      const cand = rowToContextEntry(row);
      if (seen.has(cand.id)) continue;
      if (polarityContradicts(newPolarity, polarityTags(cand.content))) {
        seen.add(cand.id);
        warnings.push({
          kind: "possible_contradiction",
          message: `Possible contradiction with "${cand.title}". A human needs to look at this.`,
          relatedEntryId: cand.id,
          relatedTitle: cand.title,
          score: scoreById.get(cand.id) ?? 0,
        });
      }
    }
  }
  return warnings;
}

/** Merges heuristic and LLM entities, deduplicating by (type + canonical name). */
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

// --- deferred reclassification (maintain) ------------------------------------

/** What a reclassification pass does with one entry. */
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

/**
 * Uses the LLM to reclassify the `type` of a project's CURRENT entries that were typed
 * HEURISTICALLY (connectors ingest cheaply). It is the piece that makes the "cheap ingestion ->
 * maintain adds intelligence" philosophy real: it fixes the types of what was already ingested
 * WITHOUT re-ingesting, and complements `CORTEX_CAPTURE_LLM` (which types during ingestion
 * itself). It touches the `type` and the `summary` (not the embedding). With no classifier
 * wired (no LLM) it is a no-op.
 *
 * Two marks keep it out: `enrichedBy='llm'` (a model typed it on the way in) and
 * `enrichedBy='distiller'` (a model typed it with the whole session window in front of it, far
 * more context than a classifier reading one entry on its own). Precedence is intact: neither
 * of those, nor what humans curated, is overwritten.
 *
 * It writes when the type changes, and when the `summary` the same call returned improves on
 * one that is only a cut of the content -- the classifier returns a summary whether we ask for
 * it or not, and it used to be thrown away, so a document chunk ingested cheaply reached the
 * pack with the first 240 characters of itself for ever (ADR-0068). What it does NOT do is
 * write to record that a type was confirmed: that is not an event in an entry's life, and one
 * UPDATE per pass per entry is (ADR-0067). A summary that changes is a change to the entry; a
 * type that stays the same is not.
 */
export async function reclassifyProject(project: string): Promise<{ scanned: number; reclassified: number }> {
  const sql = getSql();
  const projectId = await findProjectIdByName(sql, project);
  if (!projectId) throw new Error(`Project not found: "${project}".`);
  if (!classifier) return { scanned: 0, reclassified: 0 }; // no LLM -> no-op

  const rows = (await sql`
    SELECT id, title, content, summary, type, metadata
    FROM context_entries
    WHERE project_id = ${projectId} AND valid_to IS NULL
      AND COALESCE(metadata->>'enrichedBy', 'heuristic') NOT IN ('llm', 'distiller')
  `) as unknown as Row[];

  let reclassified = 0;
  for (const r of rows) {
    const res = await classifier(r.content as string).catch(() => null);
    const proposed = res?.type;
    const decision = decideReclassification(r.type as ContextEntryType, proposed);
    // Only asked of a classifier that answered: with none, the heuristic already ran on the
    // way in and re-running it here is not what this pass is for.
    const summary = res ? betterSummary(res.summary, r) : null;
    if (decision === "retype") {
      reclassified++;
      // `retype` is returned only for a type that is there and differs from the stored one.
      const meta = { ...((r.metadata as Record<string, unknown>) ?? {}), enrichedBy: "llm" } as Parameters<typeof sql.json>[0];
      await sql`
        UPDATE context_entries
        SET type = ${proposed!}, summary = ${summary ?? (r.summary as string | null)}, metadata = ${sql.json(meta)}
        WHERE id = ${r.id}
      `;
    } else if (summary) {
      await sql`UPDATE context_entries SET summary = ${summary} WHERE id = ${r.id}`;
    }
  }
  return { scanned: rows.length, reclassified };
}

/** The candidate summary for an entry, or null when what it already has must be kept. */
function betterSummary(candidate: string | undefined, row: Row): string | null {
  const title = row.title as string;
  const content = row.content as string;
  const current = (row.summary as string | null) ?? null;
  if (!isDerivedSummary(current, content, title)) return null;
  const next = stripLeadingTitle((candidate ?? summarize(content)).trim(), title).trim();
  return next && next !== current ? next : null;
}

// --- deferred re-summarising (the `resummarize` command) ---------------------

export interface ResummarizeOptions {
  /** Slug or name; with none, every project (and whatever has no project). */
  project?: string;
  /** Computes and reports without writing. Defaults to false. */
  dryRun?: boolean;
  /** Called for each entry whose summary changes, before it is written. */
  onRewrite?: (change: { id: string; title: string; before: string | null; after: string }) => void;
}

export interface ResummarizeResult {
  scanned: number;
  rewritten: number;
}

/**
 * Rebuilds the summary of the CURRENT entries whose summary is just a cut of their content,
 * with the LLM when one is wired and with the heuristic when it is not.
 *
 * It exists because the heuristic that produced those summaries was changed, and a memory is
 * mostly made of what was already stored: without this, the entries an agent reads today keep
 * the first 240 raw characters of themselves until somebody re-ingests the source.
 *
 * Writing moves `updated_at`, which the `context_entries` trigger sets on every UPDATE. That
 * movement decides nothing on its own -- confidence is counted from corroborations (ADR-0067) --
 * but it is a bulk write, which is what `dryRun` is for.
 */
export async function resummarizeEntries(opts: ResummarizeOptions = {}): Promise<ResummarizeResult> {
  const sql = getSql();
  let projectId: string | null = null;
  if (opts.project) {
    projectId = await findProjectIdByName(sql, opts.project);
    if (!projectId) throw new Error(`Project not found: "${opts.project}".`);
  }

  const rows = (await sql`
    SELECT id, title, content, summary
    FROM context_entries
    WHERE valid_to IS NULL
      ${projectId ? sql`AND project_id = ${projectId}` : sql``}
  `) as unknown as Row[];

  let rewritten = 0;
  for (const r of rows) {
    const current = (r.summary as string | null) ?? null;
    if (!isDerivedSummary(current, r.content as string, r.title as string)) continue;
    const llm = classifier ? await classifier(r.content as string).catch(() => null) : null;
    const next = betterSummary(llm?.summary, r);
    if (!next) continue;
    rewritten++;
    opts.onRewrite?.({ id: r.id as string, title: r.title as string, before: current, after: next });
    if (!opts.dryRun) await sql`UPDATE context_entries SET summary = ${next} WHERE id = ${r.id}`;
  }
  return { scanned: rows.length, rewritten };
}
