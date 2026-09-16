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
/**
 * Cuánto se empuja una entrada cuyo tipo coincide con el que nombra la pregunta.
 *
 * Medido con `admin eval`, no elegido a ojo. Entre 0.12 y 0.20 el resultado es el mismo y es
 * el mejor (recall@5 0.987, MRR 0.928); por debajo se queda corto y a partir de 0.30 el recall
 * vuelve a caer, porque empieza a colar entradas del tipo correcto pero de otro asunto. Se usa
 * el centro de esa meseta: es lo más lejos posible de los dos bordes.
 */
const TYPE_BOOST = getEnvNum("CORTEX_SEARCH_TYPE_BOOST", 0.15);

export async function searchContext(
  input: SearchContextInput,
  opts?: { restrictToAccessibleOf?: string | null },
): Promise<SearchHit[]> {
  const parsed = searchContextInput.parse(input);
  const sql = getSql();
  const provider = getEmbeddingProvider();
  const proyectoPedido = parsed.project ? await findProjectIdByName(sql, parsed.project) : null;
  // Buscar dentro de un hijo mira también lo del cliente: el context pack ya heredaba de sus
  // ancestros y la búsqueda no, así que lo transversal —contratos, convenciones, con quién se
  // habla— estaba guardado en el padre y no se encontraba desde el repo donde hacía falta.
  // Subir es seguro: `canAccessProject` restringe el hijo si cualquier ancestro es privado, de
  // modo que tener acceso al hijo implica tenerlo a toda la cadena.
  const cadena = proyectoPedido ? await projectIdsWithAncestors(proyectoPedido) : null;
  const projectId = cadena && cadena.length === 1 ? proyectoPedido : null;

  // Scoping por accesibles: solo cuando NO hay proyecto concreto Y el caller ha pedido
  // restringir (distinguimos "opts ausente" = llamada confiable, de "restrictToAccessibleOf:
  // null" = usuario anónimo → solo proyectos públicos).
  let projectIds: string[] | null | undefined;
  if (cadena && cadena.length > 1) projectIds = cadena;
  else if (!proyectoPedido && opts && "restrictToAccessibleOf" in opts) {
    const accessible = await listAccessibleProjects(opts.restrictToAccessibleOf ?? null);
    projectIds = accessible.map((p) => p.id); // array vacío permitido → cero resultados
  }

  // Si la pregunta nombra una categoría ("¿qué deuda técnica hay…?"), se usa para empujar ese
  // tipo hacia arriba. NO para filtrar: quien pregunta por decisiones puede tener la respuesta
  // guardada como restricción, y un filtro la haría desaparecer. Solo cuando el caller no ha
  // pedido un tipo explícito, que entonces manda él.
  const tipoDeducido = parsed.type ? null : inferTypeFromQuery(parsed.query);

  // Con reranker o con tipo deducido, sobre-recuperamos para reordenar un pool mayor: empujar
  // dentro de los 5 que ya salieron no serviría de nada si lo bueno estaba en el 7º. El filtro
  // por projectIds se aplica en hybridSearch (antes de reordenar), no después.
  const overFetch = reranker || tipoDeducido ? Math.min(parsed.limit * 3, 30) : parsed.limit;
  const hits = await hybridSearch(sql, provider, {
    queryText: parsed.query,
    projectId,
    projectIds,
    type: parsed.type,
    limit: overFetch,
  });

  // El empujón va en el ORDEN, no en el `score`: la puntuación que se devuelve sigue siendo la
  // similitud de verdad, porque hay quien la enseña y quien la compara con un umbral.
  const ordenados = tipoDeducido
    ? [...hits].sort(
        (a, b) =>
          b.score + (b.entry.type === tipoDeducido ? TYPE_BOOST : 0) - (a.score + (a.entry.type === tipoDeducido ? TYPE_BOOST : 0)),
      )
    : hits;

  if (!reranker) return ordenados.slice(0, parsed.limit);
  const reranked = await reranker(parsed.query, ordenados).catch(() => ordenados);
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
