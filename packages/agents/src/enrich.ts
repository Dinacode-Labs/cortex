import { extractableEntityType, isUsableEntityName, relationType } from "@cortex/shared";
import type { EntityType, RelationType } from "@cortex/shared";
import { runAgent } from "./mastra.js";
import { extractJson } from "./llm-json.js";

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}
export interface ExtractedRelation {
  /** The source entity's name, or "ENTRY" for the entry itself. */
  source: string;
  target: string;
  type: RelationType;
}
export interface GraphExtraction {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

// No 'project': the project is the container, not an entity to extract (otherwise the LLM
// invents spurious "projects" out of headers). The rule lives in shared so every extractor
// shares it (#135).
const ETYPES = extractableEntityType.options;
const RTYPES = relationType.options;

function prompt(content: string): string {
  return `From the following piece of knowledge, extract:
1) "entities": CONCRETE, reusable domain entities. Each one { "name": string, "type": one of [${ETYPES.join(", ")}] }.
   Include clients, services, integrations, external vendors, modules/areas, technologies, repositories, named decisions or incidents, and people ONLY when they are relevant (owners, decision makers). Use the natural canonical name; do NOT duplicate variants (e.g. "Acme"/"acme.com"/"Acme Corp" -> "Acme").
   Do NOT extract greetings, acknowledgements or trivial mentions. Do NOT extract the
   containing project/product as an entity of type "project" (the client's products or
   brands are "client"); ignore source headers such as
   "[Plane TICKET-xx ...]" or "[GitHub PR #n ...]".
2) "relations": MEANINGFUL relations between entities, or between the ENTRY and an entity. Each one { "source": string, "target": string, "type": one of [${RTYPES.join(", ")}] }.
   PRIORITISE semantic relations: affects, caused_by, depends_on, resolved_by, supersedes, contradicts, implemented_by. Use "related_to" ONLY when nothing else fits, and avoid trivial relations or a generic "discussed_in".
   Use "ENTRY" as the source when the relation starts from this piece (e.g. an incident ENTRY affects a service, ENTRY caused_by a vendor).

Return ONLY: {"entities":[...],"relations":[...]}. When nothing is clear, empty lists.

Knowledge:
"""
${content.slice(0, 3500)}
"""`;
}

export async function extractGraph(content: string): Promise<GraphExtraction | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await runAgent("graph", prompt(content), { maxOutputTokens: 1200 });
      const text = extractJson(raw).trim();
      if (!text) throw new Error("empty response");
      const parsed = JSON.parse(text) as {
        entities?: { name?: string; type?: string }[];
        relations?: { source?: string; target?: string; type?: string }[];
      };

      const entities = (parsed.entities ?? [])
        .filter((e): e is { name: string; type: string } => Boolean(e?.name && e?.type))
        .filter((e) => (ETYPES as readonly string[]).includes(e.type))
        .filter((e) => isUsableEntityName(e.name))
        .map((e) => ({ name: e.name.trim().slice(0, 120), type: e.type as EntityType }));

      const names = new Set(entities.map((e) => e.name.toLowerCase()));
      const relations = (parsed.relations ?? [])
        .filter((r): r is { source: string; target: string; type: string } =>
          Boolean(r?.source && r?.target && r?.type),
        )
        .filter((r) => (RTYPES as readonly string[]).includes(r.type))
        .filter(
          (r) =>
            (r.source.toUpperCase() === "ENTRY" || names.has(r.source.toLowerCase())) &&
            names.has(r.target.toLowerCase()),
        )
        .map((r) => ({ source: r.source.trim(), target: r.target.trim(), type: r.type as RelationType }));

      return { entities, relations };
    } catch (e) {
      lastErr = e;
    }
  }
  console.error("[agents] extractGraph failed:", (lastErr as Error)?.message);
  return null;
}
