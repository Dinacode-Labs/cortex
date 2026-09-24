import { extractableEntityType, relationType } from "@cortex/shared";

// No 'project': the project is the container, not an entity to extract (otherwise the LLM
// invents spurious "projects" out of headers). The rule lives in shared so every extractor
// shares it (#135).
const ETYPES = extractableEntityType.options;
const RTYPES = relationType.options;

export function graphPrompt(content: string): string {
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
