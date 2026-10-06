import type { ContextEntryType, ProjectCriteria } from "@cortex/shared";
import { MEMO_TYPE_DEFINITIONS } from "@cortex/core";

export function describeMemoTypes(types: readonly ContextEntryType[], criteria?: ProjectCriteria): string {
  return types
    .map((type) => {
      const { is, isNot } = MEMO_TYPE_DEFINITIONS[type];
      const guidance = criteria?.types[type]?.guidance;
      return `- ${type}: ${is}; not ${isNot}.${guidance ? ` In this project: ${guidance}.` : ""}`;
    })
    .join("\n");
}
