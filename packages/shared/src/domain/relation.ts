import { z } from "zod";
import { confidenceLevel } from "./memo.js";

export const relationType = z.enum([
  "belongs_to",
  "affects",
  "depends_on",
  "contradicts",
  "supersedes",
  "related_to",
  "implemented_by",
  "discussed_in",
  "caused_by",
  "resolved_by",
]);
export type RelationType = z.infer<typeof relationType>;

export const relation = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: z.string(),
  targetId: z.string().uuid(),
  targetType: z.string(),
  relationType: relationType,
  confidence: confidenceLevel,
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
});
export type Relation = z.infer<typeof relation>;
