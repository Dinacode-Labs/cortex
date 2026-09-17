import { getSql, type Sql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  type ContextEntry,
  type ContextEntryType,
  type EntityType,
  type SaveContextInput,
  saveContextInput,
  scrub,
} from "@cortex/shared";
import { linkEntryToEntity, relate, resolveEntity } from "./entities.js";
import { rowToContextEntry, type Row } from "./map.js";
import { createProject, findProjectIdByName } from "./projects.js";
import {
  canonicalize,
  classifyType,
  deriveTitle,
  extractEntities,
  polarityContradicts,
  polarityTags,
  stripLeadingTitle,
  summarize,
} from "./text.js";
import { storeEmbedding, vectorSearch } from "./vectors.js";

// --- Hook de clasificación opcional (capa LLM) -------------------------------

export interface ClassifierResult {
  type?: ContextEntryType;
  title?: string;
  summary?: string;
  entities?: { name: string; type: EntityType }[];
}

/** Función de enriquecimiento por LLM. Devuelve null si no puede clasificar. */
export type Classifier = (content: string) => Promise<ClassifierResult | null>;

let classifier: Classifier | null = null;

/**
 * Registra (o desregistra con null) un clasificador LLM. Lo cablean los
 * entrypoints (mcp-server, web) cuando hay LLM disponible, manteniendo @cortex/core
 * desacoplado de Mastra/@cortex/agents. Sin clasificador, se usan heurísticas.
 */
export function setClassifier(fn: Classifier | null): void {
  classifier = fn;
}

// --- save_project_context ----------------------------------------------------

export interface ContextWarning {
  kind: "possible_duplicate" | "possible_contradiction";
  message: string;
  relatedEntryId: string;
  relatedTitle: string;
  score: number;
}

export interface SaveContextResult {
  entry: ContextEntry;
  /** Señales del loop de mejora (duplicados/contradicciones). §12.1, §12.5. */
  warnings: ContextWarning[];
}

/**
 * Guarda una pieza de contexto con baja fricción: clasifica, resume, extrae
 * entidades, genera embedding y ejecuta los loops de detección. §11, §15.2.
 */
export interface SaveContextOptions {
  /** Si false, no invoca el clasificador LLM (lo usa el workflow, que clasifica
   *  en un paso previo y pasa type/title/summary explícitos). Por defecto true. */
  useClassifier?: boolean;
  /** Si false, omite los loops de duplicados/contradicciones (ingesta masiva).
   *  Por defecto true. */
  detectImprovements?: boolean;
  /** Si true, no genera el embedding aquí (la ingesta los hace por lotes después). */
  skipEmbedding?: boolean;
}

export async function saveContext(
  input: SaveContextInput,
  opts: SaveContextOptions = {},
): Promise<SaveContextResult> {
  const raw = saveContextInput.parse(input);
  // Última línea de defensa: el servidor NO confía en que el cliente haya escrubado
  // (los hooks y conectores lo hacen, pero la API es pública para cualquier cliente
  // autenticado). Se limpia ANTES de clasificar con el LLM, generar el embedding y
  // persistir, así que ninguna de las tres rutas ve el secreto.
  const parsed = {
    ...raw,
    content: scrub(raw.content),
    title: raw.title ? scrub(raw.title) : raw.title,
  };
  const sql = getSql();
  const provider = getEmbeddingProvider();

  // Capa LLM opcional: precedencia input explícito > LLM > heurística.
  const useClassifier = opts.useClassifier ?? true;
  const llm = useClassifier && classifier ? await classifier(parsed.content).catch(() => null) : null;
  const type = parsed.type ?? llm?.type ?? classifyType(parsed.content);
  const title = parsed.title ?? llm?.title ?? deriveTitle(parsed.content);
  // El resumen va justo debajo del título en el pack y en las tarjetas, así que empezar por
  // el título es gastar presupuesto en decir dos veces lo mismo (ADR-0054).
  const summary = stripLeadingTitle(parsed.summary ?? llm?.summary ?? summarize(parsed.content), title);
  const sourceType = parsed.sourceType ?? "manual";
  const embedText = `${title}\n\n${parsed.content}`;
  // metadata es JSON validado por zod; lo casteamos al tipo que espera sql.json.
  const enrichedBy = llm ? "llm" : ((parsed.metadata?.enrichedBy as string | undefined) ?? "heuristic");
  const meta = {
    ...(parsed.metadata ?? {}),
    enrichedBy,
  } as Parameters<typeof sql.json>[0];

  // Entidades: heurísticas + las que detecte el LLM, deduplicadas.
  const detectedEntities = mergeEntities(extractEntities(parsed.content), llm?.entities ?? []);

  let projectId: string | null = null;
  if (parsed.project) {
    // Un proyecto nacido de un `save` pasa por el mismo sitio que `cortex link --create`: con
    // slug y con dueño (ADR-0051). Antes se creaba con `resolveEntity`, que solo pone el
    // nombre, y quedaba sin slug, sin dueño y público: imposible de vincular, de adoptar y de
    // cerrar. `createProject` devuelve el que ya exista sin tocarlo, así que esto no cambia
    // nada de los que ya están.
    projectId = (await createProject(parsed.project, { ownerEmail: parsed.createdBy ?? null })).id;
  }

  const sourceRows = (await sql`
    INSERT INTO sources (source_type, raw_content, metadata)
    VALUES (${sourceType}, ${parsed.content}, ${sql.json(meta)})
    RETURNING id
  `) as unknown as Row[];
  const sourceId = sourceRows[0]!.id as string;

  const entryRows = (await sql`
    INSERT INTO context_entries
      (project_id, source_id, title, content, summary, type, confidence,
       source_type, source_reference, created_by, metadata)
    VALUES (${projectId}, ${sourceId}, ${title}, ${parsed.content}, ${summary}, ${type},
            ${parsed.confidence ?? "medium"}, ${sourceType}, ${parsed.sourceReference ?? null},
            ${parsed.createdBy ?? null}, ${sql.json(meta)})
    RETURNING *
  `) as unknown as Row[];
  const entry = rowToContextEntry(entryRows[0]!);

  if (!opts.skipEmbedding) await storeEmbedding(sql, provider, entry.id, embedText);

  // Enlace de entidades (grafo relacional)
  const entityIds: string[] = [];
  for (const e of detectedEntities) {
    const ent = await resolveEntity(sql, e.name, e.type);
    entityIds.push(ent.id);
    await linkEntryToEntity(sql, entry.id, ent.id);
    if (projectId) {
      await relate(sql, {
        sourceId: ent.id,
        sourceType: "entity",
        targetId: projectId,
        targetType: "entity",
        relationType: "belongs_to",
      });
    }
  }
  if (projectId) await linkEntryToEntity(sql, entry.id, projectId);

  const warnings =
    (opts.detectImprovements ?? true)
      ? await detectImprovements(sql, entry, projectId, embedText, entityIds)
      : [];
  return { entry, warnings };
}

/**
 * Loops de mejora (§12.1, §12.5):
 *  - Duplicado: similitud vectorial muy alta con una entrada existente.
 *  - Contradicción: polaridad opuesta (p.ej. "mantener" vs "eliminar") sobre el
 *    mismo sujeto, detectado por entidades compartidas. No depende de una alta
 *    similitud vectorial, que con embeddings léxicos locales sería poco fiable.
 */
async function detectImprovements(
  sql: Sql,
  entry: ContextEntry,
  projectId: string | null,
  embedText: string,
  entityIds: string[],
): Promise<ContextWarning[]> {
  const provider = getEmbeddingProvider();
  const warnings: ContextWarning[] = [];
  const seen = new Set<string>();
  const newPolarity = polarityTags(entry.content);

  // Duplicados por similitud vectorial.
  const hits = await vectorSearch(sql, provider, {
    queryText: embedText,
    projectId,
    limit: 6,
    excludeId: entry.id,
  });
  const scoreById = new Map(hits.map((h) => [h.entry.id, h.score]));
  for (const hit of hits) {
    if (hit.score >= 0.85 && !seen.has(hit.entry.id)) {
      seen.add(hit.entry.id);
      warnings.push({
        kind: "possible_duplicate",
        message: `Posible duplicado de "${hit.entry.title}" (similitud ${hit.score.toFixed(2)}). Considera consolidar.`,
        relatedEntryId: hit.entry.id,
        relatedTitle: hit.entry.title,
        score: hit.score,
      });
    }
  }

  // Contradicciones por polaridad opuesta sobre entidades compartidas.
  if (newPolarity.size > 0 && entityIds.length > 0) {
    const candidates = (await sql`
      SELECT DISTINCT ce.*
      FROM context_entries ce
      JOIN context_entry_entities cee ON cee.context_entry_id = ce.id
      WHERE cee.entity_id IN ${sql(entityIds)}
        AND ce.id <> ${entry.id}
        AND ce.status NOT IN ('rejected', 'obsolete')
    `) as unknown as Row[];
    for (const row of candidates) {
      const cand = rowToContextEntry(row);
      if (seen.has(cand.id)) continue;
      if (polarityContradicts(newPolarity, polarityTags(cand.content))) {
        seen.add(cand.id);
        warnings.push({
          kind: "possible_contradiction",
          message: `Posible contradicción con "${cand.title}". Requiere revisión humana.`,
          relatedEntryId: cand.id,
          relatedTitle: cand.title,
          score: scoreById.get(cand.id) ?? 0,
        });
      }
    }
  }
  return warnings;
}

/** Une entidades heurísticas y de LLM, deduplicando por (tipo + nombre canónico). */
function mergeEntities(
  ...lists: { name: string; type: EntityType }[][]
): { name: string; type: EntityType }[] {
  const byKey = new Map<string, { name: string; type: EntityType }>();
  for (const list of lists) {
    for (const e of list) {
      // Un proyecto se crea, no se extrae: venga de donde venga, aquí no pasa (#135).
      if (e.type === "project") continue;
      const key = `${e.type}:${canonicalize(e.name)}`;
      if (!byKey.has(key)) byKey.set(key, e);
    }
  }
  return [...byKey.values()];
}

// --- reclasificación diferida (maintain) -------------------------------------

/**
 * Reclasifica con el LLM el `type` de las entradas VIGENTES de un proyecto que se
 * tiparon por HEURÍSTICA (los conectores ingieren barato: `enrichedBy != 'llm'`). Es la
 * pieza que hace real la filosofía «ingesta barata → maintain añade inteligencia»: arregla
 * los tipos de lo ya ingerido SIN re-ingerir, y complementa a `CORTEX_CAPTURE_LLM` (que
 * tipa en la propia ingesta). Solo toca el `type` (no el embedding). Idempotente: marca
 * `enrichedBy='llm'`, así que la siguiente pasada salta lo ya reclasificado. Sin
 * clasificador cableado (sin LLM), es un no-op. Precedencia intacta: no pisa lo que ya
 * clasificó el LLM ni lo curado por humanos (solo entradas heurísticas).
 */
export async function reclassifyProject(project: string): Promise<{ scanned: number; reclassified: number }> {
  const sql = getSql();
  const projectId = await findProjectIdByName(sql, project);
  if (!projectId) throw new Error(`Proyecto no encontrado: "${project}".`);
  if (!classifier) return { scanned: 0, reclassified: 0 }; // sin LLM → no-op

  const rows = (await sql`
    SELECT id, content, type, metadata
    FROM context_entries
    WHERE project_id = ${projectId} AND valid_to IS NULL
      AND COALESCE(metadata->>'enrichedBy', 'heuristic') <> 'llm'
  `) as unknown as Row[];

  let reclassified = 0;
  for (const r of rows) {
    const res = await classifier(r.content as string).catch(() => null);
    if (!res?.type) continue; // el LLM no clasificó: se reintentará en la próxima pasada
    if (res.type !== r.type) reclassified++;
    const meta = { ...((r.metadata as Record<string, unknown>) ?? {}), enrichedBy: "llm" } as Parameters<typeof sql.json>[0];
    await sql`UPDATE context_entries SET type = ${res.type}, metadata = ${sql.json(meta)} WHERE id = ${r.id}`;
  }
  return { scanned: rows.length, reclassified };
}
