import { z } from "zod";

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

export const extractableEntityType = z.enum(
  entityType.options.filter((t) => t !== "project") as [Exclude<EntityType, "project">, ...Exclude<EntityType, "project">[]],
);
export type ExtractableEntityType = z.infer<typeof extractableEntityType>;

export function isUsableEntityName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 60) return false;
  if (n.split(/\s+/).length > 6) return false;
  if (/[.;]$/.test(n) || n.includes(": ")) return false;
  // Spanish on purpose: these deictics match the corpus, not our source.
  if (/^(la |el |una? )?(opci[oó]n|alternativa|caso|punto|paso|fase|v)\s*\d*[a-z]?$/i.test(n)) return false;
  return /[a-zA-Z]/.test(n);
}

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
