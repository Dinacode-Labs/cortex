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
  };
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
