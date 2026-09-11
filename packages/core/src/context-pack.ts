import { getSql, type Sql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  type ContextEntry,
  type ContextEntryType,
  type ContextEntryStatus,
} from "@cortex/shared";
import { findProjectIdByName } from "./projects.js";
import { rowToContextEntry, type Row } from "./map.js";
import { vectorSearch, type SearchHit } from "./vectors.js";

// --- validate_context_entry --------------------------------------------------

/** Cambia el estado de validación de una entrada. §15.4. */
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

// --- get_project_context_pack ------------------------------------------------

export interface ContextPack {
  project: string;
  generatedAt: Date;
  decisions: ContextEntry[];
  constraints: ContextEntry[];
  risks: ContextEntry[];
  technicalDebt: ContextEntry[];
  conventions: ContextEntry[];
  sensitiveModules: string[];
  relevantToArea: SearchHit[];
  totalEntries: number;
  /**
   * Pares de entradas del pack que se contradicen entre sí.
   *
   * No se invalida ninguna: cuál sobra es un juicio que no se puede hacer en automático sin
   * arriesgarse a borrar la buena. Pero callarlo es peor, porque el pack entrega las dos como
   * vigentes y el agente decide a ciegas. Visto en pruebas reales: dos agentes distintos lo
   * detectaron solos y lo dijeron, que es señal de que el aviso les hacía falta.
   */
  conflicts: EntryConflict[];
}

export interface EntryConflict {
  /** La entrada del pack que recibe el aviso. */
  entryId: string;
  /** Con qué choca: otra entrada, o una cosa del grafo (un módulo, un fichero, un concepto). */
  with: { label: string; recordedLater?: boolean }[];
}

/**
 * Genera un paquete de contexto para herramientas de IA (Claude Code/Codex).
 * §12.10, §15.3. Por defecto solo hechos VIGENTES; `asOf` para point-in-time.
 */
export async function getContextPack(project: string, area?: string, asOf?: Date): Promise<ContextPack> {
  const sql = getSql();
  const projectId = await findProjectIdByName(sql, project);
  if (!projectId) {
    throw new Error(`Proyecto no encontrado: "${project}".`);
  }

  // Herencia: el pack incluye el conocimiento del proyecto + el de sus ancestros (padre).
  const ids = await projectIdsWithAncestors(sql, projectId);
  const [decisions, constraints, risks, technicalDebt, conventions] = await Promise.all([
    entriesByType(sql, ids, "decision", asOf),
    entriesByType(sql, ids, "constraint", asOf),
    entriesByType(sql, ids, "risk", asOf),
    entriesByType(sql, ids, "technical_debt", asOf),
    entriesByType(sql, ids, "convention", asOf),
  ]);

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
    project,
    generatedAt: new Date(),
    decisions,
    constraints,
    risks,
    technicalDebt,
    conventions,
    sensitiveModules,
    relevantToArea,
    totalEntries,
    conflicts,
  };
}

/**
 * Contradicciones que afectan a las entradas VIGENTES del pack.
 *
 * Llegan por dos caminos y los dos cuentan. La reconciliación relaciona ENTRADA con ENTRADA
 * cuando lo nuevo contradice algo curado. El enriquecido del grafo de `maintain` relaciona
 * ENTIDADES entre sí ("README" contradice "src/webhook.js"), que en la práctica es el caso
 * frecuente: ahí el aviso va a las entradas colgadas de cada entidad, porque es lo que el
 * agente está leyendo.
 *
 * Se agrupa por entrada para no repetir cuatro avisos casi iguales en la misma línea.
 */
async function entryConflicts(sql: Sql, projectIds: string[]): Promise<EntryConflict[]> {
  const porEntrada = new Map<string, Map<string, boolean | undefined>>();
  const anota = (entryId: string, label: string, recordedLater?: boolean): void => {
    const m = porEntrada.get(entryId) ?? new Map<string, boolean | undefined>();
    if (!m.has(label)) m.set(label, recordedLater);
    porEntrada.set(entryId, m);
  };

  // 1) Entrada ↔ entrada: además de con qué choca, cuál se registró antes.
  const entreEntradas = (await sql`
    SELECT ca.id AS a_id, ca.title AS a_title, ca.created_at AS a_at,
           cb.id AS b_id, cb.title AS b_title, cb.created_at AS b_at
    FROM relations r
    JOIN context_entries ca ON ca.id = r.source_id AND ca.valid_to IS NULL
    JOIN context_entries cb ON cb.id = r.target_id AND cb.valid_to IS NULL
    WHERE r.relation_type = 'contradicts'
      AND ca.project_id = ANY(${projectIds}) AND cb.project_id = ANY(${projectIds})
    LIMIT 25
  `) as unknown as Row[];
  for (const r of entreEntradas) {
    const aNueva = new Date(r.a_at as string) >= new Date(r.b_at as string);
    anota(r.a_id as string, r.b_title as string, !aNueva);
    anota(r.b_id as string, r.a_title as string, aNueva);
  }

  // 2) Entidad ↔ entidad (y entrada ↔ entidad): el aviso baja a las entradas de cada lado.
  const conEntidades = (await sql`
    SELECT ce.id AS entry_id, otra.name AS label
    FROM relations r
    JOIN entities mia  ON mia.id  IN (r.source_id, r.target_id)
    JOIN entities otra ON otra.id IN (r.source_id, r.target_id) AND otra.id <> mia.id
    JOIN context_entry_entities cee ON cee.entity_id = mia.id
    JOIN context_entries ce ON ce.id = cee.context_entry_id
      AND ce.valid_to IS NULL AND ce.project_id = ANY(${projectIds})
    WHERE r.relation_type = 'contradicts' AND mia.type <> 'project' AND otra.type <> 'project'
    LIMIT 100
  `) as unknown as Row[];
  for (const r of conEntidades) anota(r.entry_id as string, r.label as string);

  // Tope por entrada: más de cuatro avisos en una línea ya no se leen, se saltan.
  return [...porEntrada].map(([entryId, m]) => ({
    entryId,
    with: [...m].slice(0, 4).map(([label, recordedLater]) => ({ label, recordedLater })),
  }));
}

// --- helpers -----------------------------------------------------------------

/** IDs del proyecto + todos sus ancestros (jerarquía padre). Para herencia de contexto. */
async function projectIdsWithAncestors(sql: Sql, projectId: string): Promise<string[]> {
  const rows = (await sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id FROM entities WHERE id = ${projectId}
      UNION ALL
      SELECT e.id, e.parent_id FROM entities e JOIN chain c ON e.id = c.parent_id
    )
    SELECT id FROM chain
  `) as unknown as Row[];
  return rows.map((r) => r.id as string);
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
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as unknown as Row[];
  return rows.map(rowToContextEntry);
}
