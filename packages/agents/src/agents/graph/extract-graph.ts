import { extractableEntityType, isUsableEntityName, relationType } from "@cortex/shared";
import type { EntityType, RelationType } from "@cortex/shared";
import { runAgent } from "../../runtime/run-agent.js";
import { extractJson } from "../../json.js";
import { graphPrompt } from "./prompt.js";

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

export async function extractGraph(content: string): Promise<GraphExtraction | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await runAgent("graph", graphPrompt(content), { maxOutputTokens: 1200 });
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
