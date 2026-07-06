import { entityType, relationType } from "@cortex/shared";
import type { EntityType, RelationType } from "@cortex/shared";
import { runAgent } from "./mastra.js";
import { extractJson } from "./llm-json.js";

/**
 * Agente de extracción de grafo (§7 Entity Resolution + Knowledge Graph Agents).
 * Dada una entrada de conocimiento, extrae entidades de dominio y relaciones
 * reales entre ellas (y con la propia entrada), para construir el grafo (§6).
 * Implementado como Agent de Mastra (rol "graph", ver mastra.ts).
 */

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}
export interface ExtractedRelation {
  /** Nombre de entidad origen, o "ENTRADA" para la propia entrada. */
  source: string;
  target: string;
  type: RelationType;
}
export interface GraphExtraction {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

// Excluimos 'project' de la extracción: el proyecto es el contenedor, no una
// entidad a extraer (si no, el LLM crea "proyectos" espurios de las cabeceras).
const ETYPES = entityType.options.filter((t) => t !== "project");
const RTYPES = relationType.options;

function prompt(content: string): string {
  return `De la siguiente pieza de conocimiento, extrae:
1) "entities": entidades de dominio CONCRETAS y reutilizables. Cada una { "name": string, "type": uno de [${ETYPES.join(", ")}] }.
   Incluye clientes, servicios, integraciones, proveedores externos, módulos/áreas, tecnologías, repositorios, decisiones o incidencias nombradas, y personas SOLO si son relevantes (responsables, dueños de decisión). Usa el nombre canónico natural; NO dupliques variantes (p.ej. "Acme"/"acme.com"/"Acme Corp" → "Acme").
   NO extraigas saludos, confirmaciones, ni menciones triviales. NO extraigas el
   proyecto/producto contenedor como entidad de tipo "project" (los productos o
   marcas del cliente son "client"); ignora cabeceras de origen tipo
   "[Plane TICKET-xx ...]" o "[GitHub PR #n ...]".
2) "relations": relaciones SIGNIFICATIVAS entre entidades, o entre la ENTRADA y una entidad. Cada una { "source": string, "target": string, "type": uno de [${RTYPES.join(", ")}] }.
   PRIORIZA relaciones semánticas: affects, caused_by, depends_on, resolved_by, supersedes, contradicts, implemented_by. Usa "related_to" SOLO si ninguna otra encaja, y evita relaciones triviales o de "discussed_in" genérico.
   Usa "ENTRADA" como source cuando la relación parte de esta pieza (p.ej. una incidencia ENTRADA affects un servicio, ENTRADA caused_by un proveedor).

Devuelve SOLO: {"entities":[...],"relations":[...]}. Si no hay nada claro, listas vacías.

Conocimiento:
"""
${content.slice(0, 3500)}
"""`;
}

/** Extrae grafo de una entrada. Devuelve null si falla (tolerante a errores). */
export async function extractGraph(content: string): Promise<GraphExtraction | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await runAgent("graph", prompt(content), { maxOutputTokens: 1200 });
      const text = extractJson(raw).trim();
      if (!text) throw new Error("respuesta vacía");
      const parsed = JSON.parse(text) as {
        entities?: { name?: string; type?: string }[];
        relations?: { source?: string; target?: string; type?: string }[];
      };

      const entities = (parsed.entities ?? [])
        .filter((e): e is { name: string; type: string } => Boolean(e?.name && e?.type))
        .filter((e) => (ETYPES as readonly string[]).includes(e.type))
        .map((e) => ({ name: e.name.trim().slice(0, 120), type: e.type as EntityType }));

      const names = new Set(entities.map((e) => e.name.toLowerCase()));
      const relations = (parsed.relations ?? [])
        .filter((r): r is { source: string; target: string; type: string } =>
          Boolean(r?.source && r?.target && r?.type),
        )
        .filter((r) => (RTYPES as readonly string[]).includes(r.type))
        .filter(
          (r) =>
            (r.source.toUpperCase() === "ENTRADA" || names.has(r.source.toLowerCase())) &&
            names.has(r.target.toLowerCase()),
        )
        .map((r) => ({ source: r.source.trim(), target: r.target.trim(), type: r.type as RelationType }));

      return { entities, relations };
    } catch (e) {
      lastErr = e;
    }
  }
  console.error("[agents] extractGraph falló:", (lastErr as Error)?.message);
  return null;
}
