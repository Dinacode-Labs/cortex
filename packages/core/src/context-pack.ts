import { getSql, type Sql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  type ContextEntry,
  type ContextEntryType,
  type ContextEntryStatus,
} from "@cortex/shared";
import { findProjectByName, projectIdsWithAncestors } from "./projects.js";
import { rowToContextEntry, type Row } from "./map.js";
import { vectorSearch, type SearchHit } from "./vectors.js";

/** Changes an entry's validation status. Section 15.4. */
export async function validateEntry(
  id: string,
  status: Extract<ContextEntryStatus, "validated" | "rejected" | "obsolete">,
): Promise<ContextEntry | null> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE context_entries SET status = ${status} WHERE id = ${id} RETURNING *
  `) as unknown as Row[];
  return rows[0] ? rowToContextEntry(rows[0]) : null;
}

/**
 * Which knowledge types go into the pack, in what order and with how much weight.
 *
 * This list is the reason this file exists, so it is worth reading slowly. The pack used to
 * carry only five types -- decisions, constraints, risks, debt and conventions -- because they
 * were five fields hand-written into the interface. The other nine existed, were stored and
 * were counted... and never reached an agent. Measured in a real project: **172 of 348 current
 * entries, 51%**, of types the pack did not render. Among them 38 incidents, while the same
 * project's lint warned about "incidents with no decision".
 *
 * Left out on purpose are the three types that are a **record of an event** rather than the
 * project's state: meeting, PR and ticket summaries. An agent opening a session needs to know
 * how the project stands, not what happened in a meeting back in March; that gets searched for
 * when needed. It is a decision, not an oversight -- which was exactly the earlier problem.
 *
 * The weight splits the budget: what governs today's work weighs twice what merely accompanies
 * it. See ADR-0054.
 */
export const PACK_SECTIONS: { type: ContextEntryType; title: string; weight: number }[] = [
  { type: "decision", title: "Decisions in force", weight: 2 },
  { type: "constraint", title: "Active constraints", weight: 2 },
  { type: "risk", title: "Known risks", weight: 2 },
  { type: "technical_debt", title: "Technical debt", weight: 2 },
  { type: "convention", title: "Conventions", weight: 2 },
  { type: "architecture", title: "Architecture", weight: 2 },
  { type: "business_rule", title: "Business rules", weight: 2 },
  { type: "incident", title: "Past incidents", weight: 1 },
  { type: "integration_note", title: "Integrations", weight: 1 },
  { type: "module_note", title: "Module notes", weight: 1 },
  { type: "how_to", title: "How to", weight: 1 },
];

export interface PackSection {
  type: ContextEntryType;
  title: string;
  weight: number;
  entries: ContextEntry[];
}

export interface ContextPack {
  project: string;
  generatedAt: Date;
  /** One per `PACK_SECTIONS` type that actually has entries. */
  sections: PackSection[];
  sensitiveModules: string[];
  relevantToArea: SearchHit[];
  totalEntries: number;
  /**
   * Pairs of pack entries that contradict each other.
   *
   * Neither is invalidated: which one is redundant is a judgement that cannot be made
   * automatically without risking deleting the good one. But keeping quiet is worse, because
   * the pack hands over both as current and the agent decides blind. Seen in real trials: two
   * different agents spotted it on their own and said so, which is a sign the warning was
   * needed.
   */
  conflicts: EntryConflict[];
}

export interface EntryConflict {
  /** The pack entry that receives the warning. */
  entryId: string;
  /** A direct clash with another entry: there we do know who against whom. */
  entries: { label: string; recordedLater: boolean }[];
  /**
   * Areas this entry touches that are under dispute. It is phrased that way, rather than "this
   * entry contradicts X", because that is not true: the entry hangs off an entity that
   * contradicts X, which is considerably less. Asserting the concrete pair produced absurd
   * warnings -- a decision about backoff "contradicting" the daily reconciliation -- and a
   * warning that lies teaches people to ignore every warning.
   */
  areas: { entity: string; against: string[] }[];
}

/**
 * Builds a context pack for AI tools (Claude Code/Codex). Sections 12.10 and 15.3. By default
 * only CURRENT facts; `asOf` gives a point-in-time view.
 */
export async function getContextPack(project: string, area?: string, asOf?: Date): Promise<ContextPack> {
  const sql = getSql();
  // Resolved by slug or by name (#136); the pack carries the project's NAME, not whatever was
  // typed, so the header does not say "acme-portal" when the project is called Acme Portal.
  const resolved = await findProjectByName(project);
  const projectId = resolved?.id;
  if (!resolved || !projectId) {
    throw new Error(`Project not found: "${project}".`);
  }

  const ids = await projectIdsWithAncestors(projectId);
  const byType = await Promise.all(PACK_SECTIONS.map((s) => entriesByType(sql, ids, s.type, asOf)));
  const sections: PackSection[] = PACK_SECTIONS.map((s, i) => ({ ...s, entries: byType[i]! })).filter(
    (s) => s.entries.length > 0,
  );

  const moduleRows = (await sql`
    SELECT DISTINCT e.name
    FROM entities e
    JOIN context_entry_entities cee ON cee.entity_id = e.id
    JOIN context_entries ce ON ce.id = cee.context_entry_id
    WHERE e.type = 'module' AND ce.project_id = ${projectId}
  `) as unknown as Row[];
  const sensitiveModules = moduleRows.map((r) => r.name as string);

  const countRows = (await sql`
    SELECT count(*)::int AS n FROM context_entries WHERE project_id = ${projectId}
  `) as unknown as Row[];
  const totalEntries = Number(countRows[0]!.n);

  const conflicts = await entryConflicts(sql, ids);

  let relevantToArea: SearchHit[] = [];
  if (area) {
    const provider = getEmbeddingProvider();
    relevantToArea = await vectorSearch(sql, provider, {
      queryText: area,
      projectId,
      limit: 5,
      asOf,
    });
  }

  return {
    project: resolved.name,
    generatedAt: new Date(),
    sections,
    sensitiveModules,
    relevantToArea,
    totalEntries,
    conflicts,
  };
}

/**
 * Contradictions affecting the pack's CURRENT entries.
 *
 * They arrive by two paths and are reported differently. Reconciliation relates ENTRY to ENTRY
 * when something new contradicts something curated: there we know who against whom, and we say
 * it. The graph enrichment in `maintain` relates ENTITIES to each other ("README" contradicts
 * "src/webhook.js"), which is the frequent case; there all we can say is that the area is
 * disputed, because an entry hanging off "README" does not necessarily contradict anything.
 */
/** One side of an entry-to-entry clash, with its project: who says it matters. */
export interface ContradictingSide {
  id: string;
  title: string;
  createdAt: Date;
  projectId: string | null;
}

/**
 * The pairs of CURRENT entries related by `contradicts` within a set of projects.
 *
 * It is the base query behind every contradiction in the product, and it lives in one place on
 * purpose: the pack uses it to tell each entry what it clashes with, and the client view uses
 * it to show the clashes BETWEEN projects of the same subtree. Two similar queries over
 * `relations` would end up saying different things about the same data.
 */
export async function contradictingEntryPairs(
  sql: Sql,
  projectIds: string[],
  limit = 25,
): Promise<{ a: ContradictingSide; b: ContradictingSide }[]> {
  const rows = (await sql`
    SELECT ca.id AS a_id, ca.title AS a_title, ca.created_at AS a_at, ca.project_id AS a_project,
           cb.id AS b_id, cb.title AS b_title, cb.created_at AS b_at, cb.project_id AS b_project
    FROM relations r
    JOIN context_entries ca ON ca.id = r.source_id AND ca.valid_to IS NULL
    JOIN context_entries cb ON cb.id = r.target_id AND cb.valid_to IS NULL
    WHERE r.relation_type = 'contradicts'
      AND ca.project_id = ANY(${projectIds}) AND cb.project_id = ANY(${projectIds})
    LIMIT ${limit}
  `) as unknown as Row[];
  return rows.map((r) => ({
    a: { id: r.a_id as string, title: r.a_title as string, createdAt: new Date(r.a_at as string), projectId: (r.a_project as string) ?? null },
    b: { id: r.b_id as string, title: r.b_title as string, createdAt: new Date(r.b_at as string), projectId: (r.b_project as string) ?? null },
  }));
}

async function entryConflicts(sql: Sql, projectIds: string[]): Promise<EntryConflict[]> {
  const direct = new Map<string, { label: string; recordedLater: boolean }[]>();
  const areas = new Map<string, Map<string, Set<string>>>();

  // 1) Entry-to-entry: besides what it clashes with, which one was recorded first.
  const betweenEntries = await contradictingEntryPairs(sql, projectIds);
  const noteDirect = (id: string, label: string, recordedLater: boolean): void => {
    const list = direct.get(id) ?? [];
    if (!list.some((x) => x.label === label)) list.push({ label, recordedLater });
    direct.set(id, list);
  };
  for (const { a, b } of betweenEntries) {
    const aIsNewer = a.createdAt >= b.createdAt;
    noteDirect(a.id, b.title, !aIsNewer);
    noteDirect(b.id, a.title, aIsNewer);
  }

  // 2) Disputed entities. Entries hanging off BOTH sides are excluded: those are not caught in
  //    the middle of the argument, they are the argument, and warning them about themselves
  //    says nothing.
  const withEntities = (await sql`
    SELECT ce.id AS entry_id, mine.name AS area, other.name AS against
    FROM relations r
    JOIN entities mine  ON mine.id  IN (r.source_id, r.target_id)
    JOIN entities other ON other.id IN (r.source_id, r.target_id) AND other.id <> mine.id
    JOIN context_entry_entities cee ON cee.entity_id = mine.id
    JOIN context_entries ce ON ce.id = cee.context_entry_id
      AND ce.valid_to IS NULL AND ce.project_id = ANY(${projectIds})
    WHERE r.relation_type = 'contradicts' AND mine.type <> 'project' AND other.type <> 'project'
      AND NOT EXISTS (
        SELECT 1 FROM context_entry_entities x WHERE x.context_entry_id = ce.id AND x.entity_id = other.id
      )
    LIMIT 200
  `) as unknown as Row[];
  for (const r of withEntities) {
    const byArea = areas.get(r.entry_id as string) ?? new Map<string, Set<string>>();
    const against = byArea.get(r.area as string) ?? new Set<string>();
    against.add(r.against as string);
    byArea.set(r.area as string, against);
    areas.set(r.entry_id as string, byArea);
  }

  // Caps: a warning longer than this stops being read and starts being skipped.
  const ids = new Set([...direct.keys(), ...areas.keys()]);
  return [...ids].map((entryId) => ({
    entryId,
    entries: (direct.get(entryId) ?? []).slice(0, 3),
    areas: [...(areas.get(entryId) ?? new Map())].slice(0, 2).map(([entity, against]) => ({
      entity,
      against: [...against].slice(0, 3),
    })),
  }));
}

async function entriesByType(
  sql: Sql,
  projectIds: string[],
  type: ContextEntryType,
  asOf?: Date,
  limit = 20,
): Promise<ContextEntry[]> {
  const temporal = asOf
    ? sql`AND valid_from <= ${asOf} AND (valid_to IS NULL OR valid_to > ${asOf})`
    : sql`AND valid_to IS NULL`;
  const rows = (await sql`
    SELECT * FROM context_entries
    WHERE project_id = ANY(${projectIds}) AND type = ${type}
      AND status NOT IN ('rejected', 'obsolete')
      ${temporal}
    ORDER BY CASE confidence WHEN 'verified' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             created_at DESC
    LIMIT ${limit}
  `) as unknown as Row[];
  return rows.map(rowToContextEntry);
}
