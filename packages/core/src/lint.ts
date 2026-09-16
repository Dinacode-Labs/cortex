import { getSql, type Sql } from "@cortex/database";
import { findProjectIdByName } from "./projects.js";
import type { Row } from "./map.js";

/**
 * Lint del conocimiento (patrón "LLM Wiki" de Karpathy + loops §12): health-check
 * por proyecto que reporta señales de calidad para curar la memoria.
 *
 * Todas las señales miran SOLO entradas vigentes (`valid_to IS NULL`) — salvo
 * `staleHistorical`, que precisamente cuenta las históricas. Sin este filtro, el lint
 * volvía a reportar como "duplicados" las entradas que `reconcile` ya había invalidado.
 */

export interface LintReport {
  project: string;
  totalEntries: number;
  /**
   * Los `*Id` son de ENTRADA, y pueden faltar: un extremo de una contradicción puede ser una
   * entidad, que no tiene página propia. Sin ellos el informe era una lista de títulos que no
   * llevaban a ninguna parte, y un hallazgo que no puedes abrir es un hallazgo que se ignora.
   */
  contradictions: { a: string; b: string; aId: string | null; bId: string | null }[];
  duplicates: { a: string; b: string; score: number; aId: string; bId: string }[];
  orphanEntities: { name: string; type: string }[];
  lowConfidence: number;
  staleHistorical: number;
  /**
   * Entradas vigentes que nadie ha mirado nunca.
   *
   * Es el hallazgo más grande de casi cualquier proyecto y no salía en ningún sitio: en uno
   * real, **348 de 348**. Mientras nadie valide, el estado y la confianza no distinguen nada,
   * así que el pack no puede priorizar por fiabilidad aunque sepa hacerlo. No es un fallo del
   * código —esta mitad del bucle es de personas— pero callarlo tampoco ayuda.
   */
  neverReviewed: number;
  gaps: { area: string; type: string; incidents: number }[];
}


export async function lintProject(project: string): Promise<LintReport> {
  const sql = getSql();
  const pid = await findProjectIdByName(sql, project);
  if (!pid) throw new Error(`Proyecto no encontrado: "${project}".`);

  const totalEntries = Number(
    ((await sql`SELECT count(*)::int n FROM context_entries WHERE project_id=${pid} AND valid_to IS NULL`) as unknown as Row[])[0]!.n,
  );

  // Contradicciones: relaciones 'contradicts' con algún extremo en el proyecto.
  const contraRows = (await sql`
    SELECT COALESCE(es.name, ces.title, '?') AS a, COALESCE(et.name, cet.title, '?') AS b,
           ces.id AS a_id, cet.id AS b_id
    FROM relations r
    LEFT JOIN entities es ON es.id=r.source_id
    LEFT JOIN context_entries ces ON ces.id=r.source_id
    LEFT JOIN entities et ON et.id=r.target_id
    LEFT JOIN context_entries cet ON cet.id=r.target_id
    WHERE r.relation_type='contradicts'
      AND (ces.project_id=${pid} OR cet.project_id=${pid}
           OR es.id IN (SELECT cee.entity_id FROM context_entry_entities cee JOIN context_entries c ON c.id=cee.context_entry_id WHERE c.project_id=${pid})
           OR et.id IN (SELECT cee.entity_id FROM context_entry_entities cee JOIN context_entries c ON c.id=cee.context_entry_id WHERE c.project_id=${pid}))
    LIMIT 50
  `) as unknown as Row[];

  // Duplicados casi idénticos por similitud vectorial (self-join sobre embeddings).
  const dupRows = (await sql`
    SELECT ca.title AS a, cb.title AS b, ca.id AS a_id, cb.id AS b_id,
           (1 - (a.vector <=> b.vector)) AS score
    FROM embeddings a
    JOIN embeddings b ON a.context_entry_id < b.context_entry_id
      AND a.embedding_model = b.embedding_model
    JOIN context_entries ca ON ca.id=a.context_entry_id AND ca.project_id=${pid} AND ca.valid_to IS NULL
    JOIN context_entries cb ON cb.id=b.context_entry_id AND cb.project_id=${pid} AND cb.valid_to IS NULL
    -- Umbral por tipo: entre tipos distintos un parecido alto suele ser legítimo (la incidencia
    -- que motivó una decisión se parece mucho a la decisión, y no sobra ninguna de las dos), así
    -- que ahí se mantiene el listón. Dentro del mismo tipo se baja a 0.85, porque es donde cae
    -- el eco medido en un proyecto real —la misma decisión guardada por la tool y otra vez por
    -- la destilación de la sesión, 0.86–0.88— que antes era invisible.
    --
    -- Es una señal para que alguien mire, no una verdad: reclassify puede cambiar el tipo de
    -- una entrada y juntar dos que no lo estaban. Por eso el informe dice "likely".
    WHERE (a.vector <=> b.vector) < CASE WHEN ca.type = cb.type THEN 0.15 ELSE 0.12 END
    ORDER BY score DESC
    LIMIT 25
  `) as unknown as Row[];

  // Entidades huérfanas: 1 sola entrada y sin relaciones.
  const orphanRows = (await sql`
    SELECT en.name, en.type
    FROM entities en
    JOIN context_entry_entities cee ON cee.entity_id=en.id
    JOIN context_entries ce ON ce.id=cee.context_entry_id AND ce.project_id=${pid} AND ce.valid_to IS NULL
    WHERE en.type<>'project'
      AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.source_id=en.id OR r.target_id=en.id)
    GROUP BY en.id, en.name, en.type
    HAVING count(DISTINCT cee.context_entry_id)=1
    LIMIT 40
  `) as unknown as Row[];

  const neverReviewed = Number(
    ((await sql`SELECT count(*)::int n FROM context_entries WHERE project_id=${pid} AND status='pending_validation' AND valid_to IS NULL`) as unknown as Row[])[0]!.n,
  );
  const lowConfidence = Number(
    ((await sql`SELECT count(*)::int n FROM context_entries WHERE project_id=${pid} AND confidence='low' AND valid_to IS NULL`) as unknown as Row[])[0]!.n,
  );
  const staleHistorical = Number(
    ((await sql`SELECT count(*)::int n FROM context_entries WHERE project_id=${pid} AND (validity='historical' OR metadata->>'state'='Histórico')`) as unknown as Row[])[0]!.n,
  );

  // Huecos: áreas (módulo/servicio) con incidencias pero sin decisiones documentadas.
  const gapRows = (await sql`
    SELECT en.name, en.type, count(*) FILTER (WHERE ce.type='incident') AS incidents
    FROM entities en
    JOIN context_entry_entities cee ON cee.entity_id=en.id
    JOIN context_entries ce ON ce.id=cee.context_entry_id AND ce.project_id=${pid} AND ce.valid_to IS NULL
    WHERE en.type IN ('module','service')
    GROUP BY en.id, en.name, en.type
    HAVING count(*) FILTER (WHERE ce.type='incident') >= 2
       AND count(*) FILTER (WHERE ce.type='decision') = 0
    ORDER BY incidents DESC
    LIMIT 15
  `) as unknown as Row[];

  return {
    project,
    totalEntries,
    contradictions: contraRows.map((r) => ({
      a: r.a,
      b: r.b,
      aId: (r.a_id as string | null) ?? null,
      bId: (r.b_id as string | null) ?? null,
    })),
    duplicates: dupRows.map((r) => ({
      a: r.a,
      b: r.b,
      score: Number(r.score),
      aId: r.a_id as string,
      bId: r.b_id as string,
    })),
    orphanEntities: orphanRows.map((r) => ({ name: r.name, type: r.type })),
    lowConfidence,
    staleHistorical,
    neverReviewed,
    gaps: gapRows.map((r) => ({ area: r.name, type: r.type, incidents: Number(r.incidents) })),
  };
}

/** Render del informe a Markdown (para CLI/MCP). */
export function renderLintReport(r: LintReport): string {
  const L: string[] = [`# Lint — ${r.project}`, `_${r.totalEntries} ${r.totalEntries === 1 ? "entry" : "entries"}_`, ""];
  L.push(`## ⚠️ Contradictions (${r.contradictions.length})`);
  L.push(...(r.contradictions.length ? r.contradictions.map((c) => `- ${c.a}  ⟷  ${c.b}`) : ["- (none)"]));
  L.push("", `## 🔁 Likely duplicates (${r.duplicates.length})`);
  L.push(...(r.duplicates.length ? r.duplicates.map((d) => `- (${d.score.toFixed(2)}) ${d.a}  ≈  ${d.b}`) : ["- (none)"]));
  L.push("", `## 🕳️ Gaps: areas with incidents but no decisions (${r.gaps.length})`);
  L.push(...(r.gaps.length ? r.gaps.map((g) => `- ${g.area} (${g.type}): ${g.incidents} incidents, 0 decisions`) : ["- (none)"]));
  L.push("", `## 🧩 Orphan entities (${r.orphanEntities.length})`);
  L.push(...(r.orphanEntities.length ? r.orphanEntities.slice(0, 20).map((e) => `- ${e.type}: ${e.name}`) : ["- (none)"]));
  L.push("", `## 📉 Other`, `- Low confidence: ${r.lowConfidence}`, `- Superseded or obsolete: ${r.staleHistorical}`);
  return L.join("\n");
}
