import { contextEntryType, extractableEntityType } from "@cortex/shared";

const TYPES = contextEntryType.options;
// No `project`: a project is created, not extracted (see `extractableEntityType`, #135).
const ENTITY_TYPES = extractableEntityType.options;

export function classifierPrompt(content: string): string {
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
