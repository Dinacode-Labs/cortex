import { getSql } from "@cortex/database";
import type { EntityType } from "@cortex/shared";
import { contradictingEntryPairs } from "./context-pack.js";
import { listChildProjects } from "./projects.js";
import type { ProjectRef } from "./projects.js";
import type { Row } from "./map.js";

/**
 * What can only be seen by looking at a WHOLE client: what its repos share, and where they
 * contradict each other.
 *
 * The product's inheritance goes UP -- a child reads what its client knows, never what a
 * sibling knows -- and that is right: a repo should not carry another's context. But it leaves
 * one question unanswered, and it is precisely the one a parent project exists to answer: what
 * its repos have in common, and where one decided one thing and another the opposite. Nobody
 * looks at that today.
 *
 * Going down is a DELIBERATE operation, not inheritance: it happens from the parent, by hand,
 * and filtered by permissions at every step (ADR-0063).
 */

/**
 * The entity types that count as "shared stack".
 *
 * `client`, `project` and `repository` are left out. This is not a presentation whim: the
 * extractor produces noisy entities of those three types -- the client's name appears as a
 * `client` entity in every one of its repos, and a repo's name as a `repository` -- so
 * including them would turn the list into "these repos share... the client they belong to",
 * which says nothing. `person` is out too: who worked on something is not stack.
 */
const STACK_TYPES: EntityType[] = ["technology", "module", "service", "integration", "vendor"];

/** An entity appearing in the memory of two or more children of the same client. */
export interface SharedEntity {
  name: string;
  type: EntityType;
  /** Which children it appears in. That count orders the list: shared by more goes on top. */
  projects: { name: string; slug: string | null }[];
  /** How many current entries mention it in total. It breaks ties between equally shared things. */
  entries: number;
}

/** A clash between two current entries from DIFFERENT projects in the same subtree. */
export interface CrossProjectContradiction {
  a: { id: string; title: string; project: { name: string; slug: string | null } };
  b: { id: string; title: string; project: { name: string; slug: string | null } };
}

export interface AcrossClient {
  /** The children the asker can see. When empty, there is no view to show. */
  children: ProjectRef[];
  sharedStack: SharedEntity[];
  contradictions: CrossProjectContradiction[];
}

/**
 * A client's cross-cutting view, already filtered by permissions.
 *
 * The filter lives here rather than in the interface because it is the easy part to forget: a
 * private child that `email` is not a member of must appear neither in the shared stack nor in
 * the contradictions, even when the parent is visible. Everything that crosses over comes from
 * `listChildProjects`.
 */
export async function getAcrossClient(parent: ProjectRef, email: string | null): Promise<AcrossClient> {
  const children = await listChildProjects(parent.id, email);
  if (children.length === 0) return { children: [], sharedStack: [], contradictions: [] };

  const childIds = children.map((c) => c.id);
  const [sharedStack, contradictions] = await Promise.all([
    sharedStackOf(childIds),
    crossProjectContradictions([parent.id, ...childIds]),
  ]);
  return { children, sharedStack, contradictions };
}

/**
 * Entities linked from current entries of TWO OR MORE of these projects.
 *
 * Entities are global (one row per type and canonical name across the whole installation), so
 * the cross-over has existed in the data for a long time: what was missing was somewhere to
 * look at it.
 *
 * This is "what the memory has linked from several repos", not an architecture inventory: it
 * comes from what the agents wrote, noise included. That is why it is ordered by how many it
 * appears in and then cut: a long list does not get read, and the first rows are the ones that
 * say something.
 */
async function sharedStackOf(childIds: string[], limit = 40): Promise<SharedEntity[]> {
  const rows = (await getSql()`
    SELECT e.name, e.type,
           count(DISTINCT ce.id)::int AS entries,
           json_agg(DISTINCT jsonb_build_object('name', p.name, 'slug', p.slug)) AS projects
    FROM entities e
    JOIN context_entry_entities cee ON cee.entity_id = e.id
    JOIN context_entries ce ON ce.id = cee.context_entry_id
      AND ce.valid_to IS NULL AND ce.status NOT IN ('rejected', 'obsolete')
      AND ce.project_id = ANY(${childIds})
    JOIN entities p ON p.id = ce.project_id
    WHERE e.type = ANY(${STACK_TYPES})
    GROUP BY e.id, e.name, e.type
    HAVING count(DISTINCT ce.project_id) >= 2
    ORDER BY count(DISTINCT ce.project_id) DESC, count(DISTINCT ce.id) DESC, e.name
    LIMIT ${limit}
  `) as unknown as Row[];
  return rows.map((r) => ({
    name: r.name as string,
    type: r.type as EntityType,
    entries: Number(r.entries),
    projects: (r.projects as { name: string; slug: string | null }[]).sort((x, y) => x.name.localeCompare(y.name)),
  }));
}

/**
 * Clashes between entries of DIFFERENT projects in the subtree.
 *
 * `lintProject` looks at one project, so a repo's decision clashing with its sibling's showed
 * up in neither report. The pack's pair query is reused and only what crosses over is kept:
 * within a single project, Health already reports it.
 */
async function crossProjectContradictions(projectIds: string[]): Promise<CrossProjectContradiction[]> {
  const sql = getSql();
  const pairs = await contradictingEntryPairs(sql, projectIds, 50);
  const crossing = pairs.filter((p) => p.a.projectId && p.b.projectId && p.a.projectId !== p.b.projectId);
  if (crossing.length === 0) return [];

  const ids = [...new Set(crossing.flatMap((p) => [p.a.projectId!, p.b.projectId!]))];
  const rows = (await sql`SELECT id, name, slug FROM entities WHERE id = ANY(${ids})`) as unknown as Row[];
  const byId = new Map(rows.map((f) => [f.id as string, { name: f.name as string, slug: (f.slug as string) ?? null }]));
  const unnamed = { name: "?", slug: null };

  return crossing.map((p) => ({
    a: { id: p.a.id, title: p.a.title, project: byId.get(p.a.projectId!) ?? unnamed },
    b: { id: p.b.id, title: p.b.title, project: byId.get(p.b.projectId!) ?? unnamed },
  }));
}
