import type { ProjectCriteria } from "@cortex/shared";
import type { EditSource } from "@cortex/core";

function projectRules(criteria?: ProjectCriteria): string {
  const lines = [
    criteria?.keep.length ? `This project always keeps: ${criteria.keep.join("; ")}.` : "",
    criteria?.discard.length ? `This project never keeps: ${criteria.discard.join("; ")}.` : "",
  ].filter(Boolean);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

export function editorPrompt(memo: EditSource, criteria?: ProjectCriteria): string {
  return (
    `A ${memo.type} saved on ${memo.createdAt.toISOString().slice(0, 10)}, from ${memo.sourceType}:\n` +
    `"""\n${memo.title}\n${memo.content}\n"""${projectRules(criteria)}\n\n` +
    "What do you suggest for it?"
  );
}
