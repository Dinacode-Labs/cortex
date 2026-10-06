import { z } from "zod";
import { contextEntryType } from "./memo.js";

const line = z.string().trim().min(1).max(200);

export const typeCriterion = z.object({
  keep: z.boolean(),
  guidance: line.optional(),
});
export type TypeCriterion = z.infer<typeof typeCriterion>;

export const projectCriteria = z.object({
  types: z.record(contextEntryType, typeCriterion).default({}),
  keep: z.array(line).max(20).default([]),
  discard: z.array(line).max(20).default([]),
});
export type ProjectCriteria = z.infer<typeof projectCriteria>;
