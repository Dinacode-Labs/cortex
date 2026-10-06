import { MEMO_TYPE_DEFINITIONS, type ContextEntryType } from "@cortex/shared";

export function describeMemoTypes(types: readonly ContextEntryType[]): string {
  return types
    .map((type) => `- ${type}: ${MEMO_TYPE_DEFINITIONS[type].is}; not ${MEMO_TYPE_DEFINITIONS[type].isNot}.`)
    .join("\n");
}
