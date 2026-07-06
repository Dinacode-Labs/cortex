import { getSql, type Sql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import {
  type ContextEntry,
  type ContextEntryType,
  type EntityType,
  type SaveContextInput,
  saveContextInput,
} from "@cortex/shared";
import { linkEntryToEntity, relate, resolveEntity } from "./entities.js";
import { rowToContextEntry, type Row } from "./map.js";
import {
  canonicalize,
  classifyType,
  deriveTitle,
  extractEntities,
  polarityContradicts,
  polarityTags,
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
  const parsed = saveContextInput.parse(input);
  const sql = getSql();
  const provider = getEmbeddingProvider();

  // Capa LLM opcional: precedencia input explícito > LLM > heurística.
  const useClassifier = opts.useClassifier ?? true;
  const llm = useClassifier && classifier ? await classifier(parsed.content).catch(() => null) : null;
  const type = parsed.type ?? llm?.type ?? classifyType(parsed.content);
  const title = parsed.title ?? llm?.title ?? deriveTitle(parsed.content);
  const summary = parsed.summary ?? llm?.summary ?? summarize(parsed.content);
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
    projectId = (await resolveEntity(sql, parsed.project, "project")).id;
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
      const key = `${e.type}:${canonicalize(e.name)}`;
      if (!byKey.has(key)) byKey.set(key, e);
    }
  }
  return [...byKey.values()];
}
