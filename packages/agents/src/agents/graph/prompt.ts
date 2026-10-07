import { extractableEntityType, relationType } from "@cortex/core";

// No 'project': the project is the container, not an entity to extract (otherwise the LLM
// invents spurious "projects" out of headers). The rule lives in core so every extractor
// shares it (#135).
const ETYPES = extractableEntityType.options;
const RTYPES = relationType.options;

export function graphPrompt(content: string): string {
  return `From the following piece of knowledge, extract:
1) "entities": each one { "name": string, "type": one of [${ETYPES.join(", ")}] }.
2) "relations": between entities, or between the ENTRY and an entity. Each one { "source": string, "target": string, "type": one of [${RTYPES.join(", ")}] }.
   Use "ENTRY" as the source when the relation starts from this piece (e.g. an incident ENTRY affects a service, ENTRY caused_by a vendor).

Return ONLY: {"entities":[...],"relations":[...]}. When nothing is clear, empty lists.

Knowledge:
"""
${content.slice(0, 3500)}
"""`;
}
