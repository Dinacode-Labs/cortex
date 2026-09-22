import { getSql, type Sql } from "@cortex/database";
import { findProjectIdByName } from "./projects.js";
import type { Row } from "./map.js";

/**
 * Knowledge lint (Karpathy's "LLM Wiki" pattern + the loops of section 12): a per-project
 * health check that reports quality signals for curating the memory.
 *
 * Every signal looks ONLY at current entries (`valid_to IS NULL`) -- except
 * `staleHistorical`, which is precisely a count of the historical ones. Without that filter,
 * the lint kept reporting as "duplicates" the entries `reconcile` had already invalidated.
 */

export interface LintReport {
  project: string;
  totalEntries: number;
  /**
   * The `*Id`s are ENTRY ids, and they can be missing: one end of a contradiction may be an
   * entity, which has no page of its own. Without them the report was a list of titles that
   * led nowhere, and a finding you cannot open is a finding that gets ignored.
   */
  contradictions: { a: string; b: string; aId: string | null; bId: string | null }[];
  duplicates: { a: string; b: string; score: number; aId: string; bId: string }[];
  orphanEntities: { name: string; type: string }[];
  lowConfidence: number;
  staleHistorical: number;
  /**
   * Current entries nobody has ever looked at.
   *
   * It is the largest finding in almost any project and it showed up nowhere: in a real one,
   * **348 out of 348**. While nobody validates, status and confidence tell nothing apart, so
   * the pack cannot prioritise by reliability even though it knows how. This is not a bug in
   * the code -- this half of the loop belongs to people -- but keeping quiet does not help
   * either.
   */
  neverReviewed: number;
  gaps: { area: string; type: string; incidents: number }[];
}


export async function lintProject(project: string): Promise<LintReport> {
  const sql = getSql();
  const pid = await findProjectIdByName(sql, project);
  if (!pid) throw new Error(`Project not found: "${project}".`);

  const totalEntries = Number(
    ((await sql`SELECT count(*)::int n FROM context_entries WHERE project_id=${pid} AND valid_to IS NULL`) as unknown as Row[])[0]!.n,
  );

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

  // Near-identical duplicates by vector similarity (a self-join over embeddings).
  //
  // `doc_key` is which document an entry came out of. An ingested file is split into
  // overlapping chunks (`chunkDocument`, ADR-0023) that share 400 characters by construction
  // and each land as their own entry -- `metadata.file` names the file they all came from,
  // while `source_reference` is `ref#0`, `ref#1`… and differs. "Doc (1/4)" against
  // "Doc (2/4)" therefore scored at the very top and filled the 25 rows the report shows,
  // burying the duplicates that are worth looking at. Consecutive parts of one source are
  // neighbours, not duplicates. A missing or empty reference groups with nothing: an entry
  // with no source is not "the same document" as every other entry with no source.
  const dupRows = (await sql`
    WITH current_entries AS (
      SELECT id, title, type, NULLIF(COALESCE(metadata->>'file', source_reference), '') AS doc_key
      FROM context_entries
      WHERE project_id=${pid} AND valid_to IS NULL
    )
    SELECT ca.title AS a, cb.title AS b, ca.id AS a_id, cb.id AS b_id,
           (1 - (a.vector <=> b.vector)) AS score
    FROM embeddings a
    JOIN embeddings b ON a.context_entry_id < b.context_entry_id
      AND a.embedding_model = b.embedding_model
    JOIN current_entries ca ON ca.id=a.context_entry_id
    JOIN current_entries cb ON cb.id=b.context_entry_id
    -- Threshold per type: across different types a high similarity is usually legitimate (the
    -- incident that prompted a decision looks a lot like the decision, and neither is
    -- redundant), so the bar stays high there. Within the same type it drops to 0.85, because
    -- that is where the echo measured in a real project falls -- the same decision stored by
    -- the tool and again by the session's distillation, 0.86-0.88 -- which used to be invisible.
    --
    -- It is a signal for someone to look at, not a truth: reclassify can change an entry's type
    -- and bring together two that were not. That is why the report says "likely".
    WHERE (a.vector <=> b.vector) < CASE WHEN ca.type = cb.type THEN 0.15 ELSE 0.12 END
      AND (ca.doc_key IS NULL OR ca.doc_key IS DISTINCT FROM cb.doc_key)
    ORDER BY score DESC
    LIMIT 25
  `) as unknown as Row[];

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
    ((await sql`SELECT count(*)::int n FROM context_entries WHERE project_id=${pid} AND (validity='historical' OR metadata->>'state'='Histórico')`) as unknown as Row[])[0]!.n, // 'Histórico' is Plane's own value
  );

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
  L.push(
    "",
    `## 📉 Other`,
    `- Never reviewed by a person: ${r.neverReviewed} of ${r.totalEntries}`,
    `- Low confidence: ${r.lowConfidence}`,
    `- Superseded or obsolete: ${r.staleHistorical}`,
  );
  return L.join("\n");
}
