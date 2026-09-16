import { getSql, type Sql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  type ContextEntry,
  type ContextEntryType,
  type ContextEntryStatus,
} from "@cortex/shared";
import { findProjectIdByName, projectIdsWithAncestors } from "./projects.js";
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

/**
 * Qué tipos de conocimiento entran en el pack, en qué orden y con cuánto peso.
 *
 * Esta lista es la razón de ser de este fichero, así que conviene leerla despacio. Antes el
 * pack solo llevaba cinco tipos —decisiones, restricciones, riesgos, deuda y convenciones—
 * porque eran cinco campos escritos a mano en la interfaz. Los otros nueve existían, se
 * guardaban y se contaban… y no llegaban nunca a un agente. Medido en un proyecto real: **172
 * de 348 entradas vigentes, el 51 %**, de tipos que el pack no renderizaba. Entre ellas 38
 * incidencias, mientras el lint del mismo proyecto avisaba de «incidencias sin decisión».
 *
 * Fuera se quedan, a propósito, los tres tipos que son **registro de un suceso** y no estado
 * del proyecto: resúmenes de reunión, de PR y de ticket. Un agente que abre sesión necesita
 * saber cómo está el proyecto, no qué pasó en una reunión de marzo; eso se busca cuando hace
 * falta. Es una decisión, no un olvido — que era justo el problema de antes.
 *
 * El peso reparte el presupuesto: lo que gobierna el trabajo de hoy pesa el doble que lo que
 * lo acompaña. Ver ADR-0054.
 */
export const PACK_SECTIONS: { type: ContextEntryType; titulo: string; peso: number }[] = [
  { type: "decision", titulo: "Decisions in force", peso: 2 },
  { type: "constraint", titulo: "Active constraints", peso: 2 },
  { type: "risk", titulo: "Known risks", peso: 2 },
  { type: "technical_debt", titulo: "Technical debt", peso: 2 },
  { type: "convention", titulo: "Conventions", peso: 2 },
  { type: "architecture", titulo: "Architecture", peso: 2 },
  { type: "business_rule", titulo: "Business rules", peso: 2 },
  { type: "incident", titulo: "Past incidents", peso: 1 },
  { type: "integration_note", titulo: "Integrations", peso: 1 },
  { type: "module_note", titulo: "Module notes", peso: 1 },
  { type: "how_to", titulo: "How to", peso: 1 },
];

export interface PackSection {
  type: ContextEntryType;
  titulo: string;
  peso: number;
  entries: ContextEntry[];
}

export interface ContextPack {
  project: string;
  generatedAt: Date;
  /** Una por tipo de `PACK_SECTIONS` que tenga entradas. */
  sections: PackSection[];
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
  /** Choque directo con otra entrada: ahí sí se sabe quién contra quién. */
  entries: { label: string; recordedLater: boolean }[];
  /**
   * Zonas que esta entrada toca y que están en disputa. Se dice así, y no "esta entrada
   * contradice a X", porque no es verdad: la entrada está colgada de una entidad que
   * contradice a X, que es bastante menos. Afirmar el par concreto daba avisos absurdos —una
   * decisión sobre el backoff "contradiciendo" la conciliación diaria— y un aviso que miente
   * enseña a ignorar todos los avisos.
   */
  areas: { entity: string; against: string[] }[];
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
  const ids = await projectIdsWithAncestors(projectId);
  const porTipo = await Promise.all(PACK_SECTIONS.map((s) => entriesByType(sql, ids, s.type, asOf)));
  const sections: PackSection[] = PACK_SECTIONS.map((s, i) => ({ ...s, entries: porTipo[i]! })).filter(
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
    project,
    generatedAt: new Date(),
    sections,
    sensitiveModules,
    relevantToArea,
    totalEntries,
    conflicts,
  };
}

/**
 * Contradicciones que afectan a las entradas VIGENTES del pack.
 *
 * Llegan por dos caminos y se cuentan distinto. La reconciliación relaciona ENTRADA con
 * ENTRADA cuando lo nuevo contradice algo curado: ahí se sabe quién contra quién y se dice.
 * El enriquecido del grafo de `maintain` relaciona ENTIDADES entre sí ("README" contradice
 * "src/webhook.js"), que es el caso frecuente; ahí solo se puede decir que la zona está en
 * disputa, porque una entrada colgada de "README" no contradice necesariamente nada.
 */
async function entryConflicts(sql: Sql, projectIds: string[]): Promise<EntryConflict[]> {
  const directos = new Map<string, { label: string; recordedLater: boolean }[]>();
  const zonas = new Map<string, Map<string, Set<string>>>();

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
  const anotaDirecto = (id: string, label: string, recordedLater: boolean): void => {
    const lista = directos.get(id) ?? [];
    if (!lista.some((x) => x.label === label)) lista.push({ label, recordedLater });
    directos.set(id, lista);
  };
  for (const r of entreEntradas) {
    const aNueva = new Date(r.a_at as string) >= new Date(r.b_at as string);
    anotaDirecto(r.a_id as string, r.b_title as string, !aNueva);
    anotaDirecto(r.b_id as string, r.a_title as string, aNueva);
  }

  // 2) Entidades en disputa. Se excluyen las entradas colgadas de AMBOS lados: esas no están
  //    en medio de la discusión, son la discusión, y avisarlas de sí mismas no dice nada.
  const conEntidades = (await sql`
    SELECT ce.id AS entry_id, mia.name AS zona, otra.name AS contra
    FROM relations r
    JOIN entities mia  ON mia.id  IN (r.source_id, r.target_id)
    JOIN entities otra ON otra.id IN (r.source_id, r.target_id) AND otra.id <> mia.id
    JOIN context_entry_entities cee ON cee.entity_id = mia.id
    JOIN context_entries ce ON ce.id = cee.context_entry_id
      AND ce.valid_to IS NULL AND ce.project_id = ANY(${projectIds})
    WHERE r.relation_type = 'contradicts' AND mia.type <> 'project' AND otra.type <> 'project'
      AND NOT EXISTS (
        SELECT 1 FROM context_entry_entities x WHERE x.context_entry_id = ce.id AND x.entity_id = otra.id
      )
    LIMIT 200
  `) as unknown as Row[];
  for (const r of conEntidades) {
    const porZona = zonas.get(r.entry_id as string) ?? new Map<string, Set<string>>();
    const contra = porZona.get(r.zona as string) ?? new Set<string>();
    contra.add(r.contra as string);
    porZona.set(r.zona as string, contra);
    zonas.set(r.entry_id as string, porZona);
  }

  // Topes: un aviso con más de esto ya no se lee, se salta.
  const ids = new Set([...directos.keys(), ...zonas.keys()]);
  return [...ids].map((entryId) => ({
    entryId,
    entries: (directos.get(entryId) ?? []).slice(0, 3),
    areas: [...(zonas.get(entryId) ?? new Map())].slice(0, 2).map(([entity, against]) => ({
      entity,
      against: [...against].slice(0, 3),
    })),
  }));
}

// --- helpers -----------------------------------------------------------------

/** IDs del proyecto + todos sus ancestros (jerarquía padre). Para herencia de contexto. */

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
