import { z } from "zod";

/**
 * Entity type in the relational graph. Section 14, entities.type
 *
 * An entity is a **thing that has a name** -- a module, a service, a technology, a client --
 * not a claim about the project. This enum used to include `decision` and `incident`, which
 * are ENTRY types, and the result was a shadow graph: the same decision stored twice, once
 * as an entry and once as a node whose name was the whole sentence. One real installation
 * had 222 nodes like that, with names such as "Publish Cortex openly and monetise the
 * implementation". They polluted the orphan list, the map and -- above all -- the
 * contradictions, which came out between node names instead of between entries. See ADR-0055.
 */
export const entityType = z.enum([
  "client",
  "project",
  "repository",
  "module",
  "service",
  "technology",
  "person",
  "integration",
  "vendor",
]);
export type EntityType = z.infer<typeof entityType>;

/**
 * The types OFFERED to the extractor (classifier and graph). `project` is absent: a project
 * is the container of the memory and is born through `createProject` -- with a slug and an
 * owner -- not from a proper noun the LLM read as a project. While it was offered, every
 * ticket, branch or microservice mentioned ended up in `entities` with `type='project'`: the
 * same row as a real project, and it showed up in `cortex link` and in the UI as such (#135).
 * Same pattern as ADR-0055 with `decision`/`incident`, but here the type is legitimate, so
 * it is removed from what gets extracted, not from the enum.
 */
export const extractableEntityType = z.enum(
  entityType.options.filter((t) => t !== "project") as [Exclude<EntityType, "project">, ...Exclude<EntityType, "project">[]],
);
export type ExtractableEntityType = z.infer<typeof extractableEntityType>;

/**
 * Whether a name works as a graph entity.
 *
 * Entities are names, not sentences. The extractor used to return things like "opcion C",
 * "Do not assume source paths in the target" or "package", which then showed up as orphans
 * and paired with each other in the contradiction report. A report that is half noise teaches
 * people not to look at it, so the bar is set here: if it does not look like the proper name
 * of something in the domain, it does not get in.
 */
export function isUsableEntityName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 60) return false;
  if (n.split(/\s+/).length > 6) return false; // a sentence, not a name
  if (/[.;]$/.test(n) || n.includes(": ")) return false;
  // Spanish on purpose: this matches the corpus, not our source. Deictics -- "opcion C",
  // "la opcion a", "v3", "caso 2" -- name nothing on their own. Add a language here only
  // when a corpus in that language is actually being ingested.
  if (/^(la |el |una? )?(opci[oó]n|alternativa|caso|punto|paso|fase|v)\s*\d*[a-z]?$/i.test(n)) return false;
  return /[a-zA-Z]/.test(n);
}

/** An entity in the relational graph. Section 14, entities */
export const entity = z.object({
  id: z.string().uuid(),
  name: z.string(),
  canonicalName: z.string(),
  type: entityType,
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Entity = z.infer<typeof entity>;
