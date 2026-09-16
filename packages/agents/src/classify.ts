import { contextEntryType, entityType, isUsableEntityName } from "@cortex/shared";
import type { ContextEntryType, EntityType } from "@cortex/shared";
import { runAgent } from "./mastra.js";
import { extractJson } from "./llm-json.js";

/**
 * Agente de clasificación / ingesta (§7). Dado un texto libre de conocimiento,
 * propone tipo, título, resumen y entidades mencionadas. Mejora las heurísticas
 * locales de @cortex/core cuando hay LLM disponible. Implementado como Agent de
 * Mastra (rol "classifier", ver mastra.ts).
 */

export interface ClassificationResult {
  type?: ContextEntryType;
  title?: string;
  summary?: string;
  entities: { name: string; type: EntityType }[];
}

const TYPES = contextEntryType.options;
const ENTITY_TYPES = entityType.options;

function userPrompt(content: string): string {
  return `Analiza esta pieza de conocimiento de un proyecto y devuelve un objeto JSON con:
- "type": uno de [${TYPES.join(", ")}]
- "title": título corto (máx 100 caracteres)
- "summary": resumen en 1-2 frases
- "entities": lista de entidades mencionadas, cada una { "name": string, "type": uno de [${ENTITY_TYPES.join(", ")}] }
  (extrae tecnologías, módulos, servicios, integraciones, clientes, personas relevantes)

Texto:
"""
${content}
"""

Responde solo con el JSON.`;
}

/**
 * Clasifica una entrada con el LLM. Devuelve null si falla (el llamador debe caer
 * a heurísticas). Valida los enums a mano para tolerar variaciones del modelo.
 */
export async function classifyEntry(content: string): Promise<ClassificationResult | null> {
  // DeepSeek es un modelo de razonamiento: dejamos presupuesto amplio para que
  // tras el razonamiento quede espacio para el JSON, y reintentamos una vez si la
  // respuesta llega vacía/truncada.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await runAgent("classifier", userPrompt(content), { maxOutputTokens: 2000 });
      const text = extractJson(raw).trim();
      if (!text) throw new Error("respuesta vacía del modelo");
      const parsed = JSON.parse(text) as {
        type?: string;
        title?: string;
        summary?: string;
        entities?: { name?: string; type?: string }[];
      };

      const type = parsed.type && (TYPES as readonly string[]).includes(parsed.type)
        ? (parsed.type as ContextEntryType)
        : undefined;

      const entities = (parsed.entities ?? [])
        .filter((e): e is { name: string; type: string } => Boolean(e?.name && e?.type))
        .filter((e) => (ENTITY_TYPES as readonly string[]).includes(e.type))
        .filter((e) => isUsableEntityName(e.name))
        .map((e) => ({ name: e.name.trim(), type: e.type as EntityType }));

      return {
        type,
        title: parsed.title?.trim() || undefined,
        summary: parsed.summary?.trim() || undefined,
        entities,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  console.error("[agents] classifyEntry falló, se usarán heurísticas:", (lastErr as Error)?.message);
  return null;
}
