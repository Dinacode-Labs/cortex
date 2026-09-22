import { contextEntryType, extractableEntityType, isUsableEntityName } from "@cortex/shared";
import type { ContextEntryType, EntityType } from "@cortex/shared";
import { runAgent } from "./mastra.js";
import { extractJson } from "./llm-json.js";

export interface ClassificationResult {
  type?: ContextEntryType;
  title?: string;
  summary?: string;
  entities: { name: string; type: EntityType }[];
}

const TYPES = contextEntryType.options;
// No `project`: a project is created, not extracted (see `extractableEntityType`, #135).
const ENTITY_TYPES = extractableEntityType.options;

function userPrompt(content: string): string {
  return `Analyse this piece of knowledge from a project and return a JSON object with:
- "type": one of [${TYPES.join(", ")}]
- "title": a short title (100 characters max)
- "summary": a 1-2 sentence summary
- "entities": the entities mentioned, each one { "name": string, "type": one of [${ENTITY_TYPES.join(", ")}] }
  (extract technologies, modules, services, integrations, clients, relevant people;
  do NOT extract the containing project or product, nor tickets, branches or file names)

Text:
"""
${content}
"""

Answer with the JSON only.`;
}

/**
 * Classifies an entry with the LLM. Returns null on failure (the caller must fall back to the
 * heuristics). The enums are validated by hand so model variations are tolerated.
 */
export async function classifyEntry(content: string): Promise<ClassificationResult | null> {
  // Reasoning models need room: the budget is generous so that JSON still fits after the
  // reasoning, and we retry once when the answer arrives empty or truncated.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await runAgent("classifier", userPrompt(content), { maxOutputTokens: 2000 });
      const text = extractJson(raw).trim();
      if (!text) throw new Error("empty response from the model");
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
  console.error("[agents] classifyEntry failed, falling back to heuristics:", (lastErr as Error)?.message);
  return null;
}
