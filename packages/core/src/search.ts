import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  getEnvNum,
  type ContextEntry,
  type SearchContextInput,
  searchContextInput,
} from "@cortex/shared";
import { findProjectIdByName, listAccessibleProjects, projectIdsWithAncestors } from "./projects.js";
import { rowToContextEntry, type Row } from "./map.js";
import { hybridSearch, type SearchHit } from "./vectors.js";
import { inferTypeFromQuery } from "./query-intent.js";

export type { SearchHit } from "./vectors.js";

// --- Optional rerank hook (the LLM layer) ------------------------------------

/** Optional second-stage reranker (e.g. an LLM). It reorders the hits by relevance. */
export type Reranker = (query: string, hits: SearchHit[]) => Promise<SearchHit[]>;

let reranker: Reranker | null = null;

/** Registers (or, with null, unregisters) a reranker. Wired by the entrypoints. */
export function setReranker(fn: Reranker | null): void {
  reranker = fn;
}

// --- search_project_context --------------------------------------------------

/**
 * Hybrid search (vector + FTS + RRF) with optional rerank. Section 15.6.
 *
 * SECURITY SCOPING (P0): without `input.project`, the default is to search across ALL
 * projects (trusted local behaviour, e.g. stdio MCP). Network-exposed callers (authenticated
 * MCP, web) must pass `opts.restrictToAccessibleOf` with the user's email (or null) to limit
 * the search to accessible projects and avoid leaking content from other people's private
 * projects. With a concrete `input.project` the behaviour is unchanged (the caller's guard
 * already controls access to that project).
 */
/**
 * How hard an entry is nudged when its type matches the one the question names.
 *
 * Measured with `admin eval`, not picked by eye. Between 0.12 and 0.20 the result is the same
 * and it is the best (recall@5 0.987, MRR 0.928); below that it falls short, and from 0.30
 * recall drops again, because it starts letting in entries of the right type but the wrong
 * subject. The centre of that plateau is used: it is as far as possible from both edges.
 */
const TYPE_BOOST = getEnvNum("CORTEX_SEARCH_TYPE_BOOST", 0.15);

export async function searchContext(
  input: SearchContextInput,
  opts?: {
    restrictToAccessibleOf?: string | null;
    /**
     * EXTRA projects to include besides the one asked for and its ancestors. This is how one
     * searches downwards from a parent (ADR-0063): a deliberate operation, not inheritance,
     * which goes up. The caller is responsible for having filtered those ids by permissions --
     * in the web they come from `listChildProjects`, which already does -- because there is no
     * way here to tell a legitimate id from an invented one.
     */
    alsoProjectIds?: string[];
  },
): Promise<SearchHit[]> {
  const parsed = searchContextInput.parse(input);
  const sql = getSql();
  const provider = getEmbeddingProvider();
  const askedProject = parsed.project ? await findProjectIdByName(sql, parsed.project) : null;
  // Searching inside a child also looks at the client's knowledge: the context pack already
  // inherited from its ancestors and search did not, so the cross-cutting things -- contracts,
  // conventions, who to talk to -- were stored in the parent and could not be found from the
  // repo where they were needed. Going up is safe: `canAccessProject` restricts the child when
  // any ancestor is private, so having access to the child implies having it to the whole chain.
  const extra = opts?.alsoProjectIds?.length ? opts.alsoProjectIds : [];
  const chain = askedProject ? [...new Set([...(await projectIdsWithAncestors(askedProject)), ...extra])] : null;
  const projectId = chain && chain.length === 1 ? askedProject : null;

  // Scoping by accessible projects: only when there is NO concrete project AND the caller asked
  // to restrict (we distinguish "opts absent" = trusted call from "restrictToAccessibleOf:
  // null" = anonymous user -> public projects only).
  let projectIds: string[] | null | undefined;
  if (chain && chain.length > 1) projectIds = chain;
  else if (!askedProject && opts && "restrictToAccessibleOf" in opts) {
    const accessible = await listAccessibleProjects(opts.restrictToAccessibleOf ?? null);
    projectIds = accessible.map((p) => p.id); // an empty array is allowed -> zero results
  }

  // When the question names a category ("what technical debt is there...?"), it is used to nudge
  // that type upwards. NOT to filter: someone asking about decisions may have the answer stored
  // as a constraint, and a filter would make it vanish. Only when the caller did not ask for an
  // explicit type, in which case theirs wins.
  const inferredType = parsed.type ? null : inferTypeFromQuery(parsed.query);

  // With a reranker or an inferred type, over-fetch so a larger pool can be reordered: nudging
  // within the 5 that already came out would be useless if the good one was 7th. The projectIds
  // filter is applied in hybridSearch (before reordering), not after.
  const overFetch = reranker || inferredType ? Math.min(parsed.limit * 3, 30) : parsed.limit;
  const hits = await hybridSearch(sql, provider, {
    queryText: parsed.query,
    projectId,
    projectIds,
    type: parsed.type,
    limit: overFetch,
  });

  // The nudge goes into the ORDER, not into the `score`: the score returned is still the real
  // similarity, because some callers display it and others compare it against a threshold.
  const ordered = inferredType
    ? [...hits].sort(
        (a, b) =>
          b.score + (b.entry.type === inferredType ? TYPE_BOOST : 0) - (a.score + (a.entry.type === inferredType ? TYPE_BOOST : 0)),
      )
    : hits;

  if (!reranker) return ordered.slice(0, parsed.limit);
  const reranked = await reranker(parsed.query, ordered).catch(() => ordered);
  return reranked.slice(0, parsed.limit);
}

// --- list_project_decisions --------------------------------------------------

/** Lists a project's technical decisions. */
export async function listDecisions(project: string, limit = 20): Promise<ContextEntry[]> {
  const sql = getSql();
  const projectId = await findProjectIdByName(sql, project);
  if (!projectId) return [];
  const rows = (await sql`
    SELECT * FROM context_entries
    WHERE project_id = ${projectId} AND type = 'decision'
      AND status NOT IN ('rejected') AND valid_to IS NULL
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as unknown as Row[];
  return rows.map(rowToContextEntry);
}
