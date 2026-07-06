import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  type ContextEntry,
  type SearchContextInput,
  searchContextInput,
} from "@cortex/shared";
import { findProjectIdByName, listAccessibleProjects } from "./projects.js";
import { rowToContextEntry, type Row } from "./map.js";
import { hybridSearch, type SearchHit } from "./vectors.js";

export type { SearchHit } from "./vectors.js";

// --- Hook de rerank opcional (capa LLM) --------------------------------------

/** Reranker opcional de 2ª etapa (p.ej. LLM). Reordena los hits por relevancia. */
export type Reranker = (query: string, hits: SearchHit[]) => Promise<SearchHit[]>;

let reranker: Reranker | null = null;

/** Registra (o desregistra con null) un reranker. Lo cablean los entrypoints. */
export function setReranker(fn: Reranker | null): void {
  reranker = fn;
}

// --- search_project_context --------------------------------------------------

/**
 * Búsqueda híbrida (vector + FTS + RRF) con rerank opcional. §15.6.
 *
 * SCOPING DE SEGURIDAD (P0): sin `input.project`, por defecto se busca en TODOS los
 * proyectos (comportamiento confiable local, p.ej. stdio MCP). Los callers expuestos
 * a red (MCP autenticado, web) deben pasar `opts.restrictToAccessibleOf` con el email
 * del usuario (o null) para restringir la búsqueda a los proyectos accesibles y no
 * filtrar contenido de proyectos privados ajenos. Con `input.project` concreto el
 * comportamiento es intacto (el guard del caller ya controla el acceso a ese proyecto).
 */
export async function searchContext(
  input: SearchContextInput,
  opts?: { restrictToAccessibleOf?: string | null },
): Promise<SearchHit[]> {
  const parsed = searchContextInput.parse(input);
  const sql = getSql();
  const provider = getEmbeddingProvider();
  const projectId = parsed.project ? await findProjectIdByName(sql, parsed.project) : null;

  // Scoping por accesibles: solo cuando NO hay proyecto concreto Y el caller ha pedido
  // restringir (distinguimos "opts ausente" = llamada confiable, de "restrictToAccessibleOf:
  // null" = usuario anónimo → solo proyectos públicos).
  let projectIds: string[] | null | undefined;
  if (!projectId && opts && "restrictToAccessibleOf" in opts) {
    const accessible = await listAccessibleProjects(opts.restrictToAccessibleOf ?? null);
    projectIds = accessible.map((p) => p.id); // array vacío permitido → cero resultados
  }

  // Si hay reranker, sobre-recuperamos para que reordene un pool mayor. El filtro por
  // projectIds se aplica en hybridSearch (antes del rerank), no filtra tras reordenar.
  const overFetch = reranker ? Math.min(parsed.limit * 3, 30) : parsed.limit;
  const hits = await hybridSearch(sql, provider, {
    queryText: parsed.query,
    projectId,
    projectIds,
    type: parsed.type,
    limit: overFetch,
  });
  if (!reranker) return hits;
  const reranked = await reranker(parsed.query, hits).catch(() => hits);
  return reranked.slice(0, parsed.limit);
}

// --- list_project_decisions --------------------------------------------------

/** Lista las decisiones técnicas de un proyecto. */
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
