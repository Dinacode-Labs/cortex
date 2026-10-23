import type { MergeSource } from "@cortex/core";

export function mergerPrompt(existing: string, incoming: string): string {
  return `Existing entry:\n"""\n${existing}\n"""\n\nNew information about the same thing:\n"""\n${incoming}\n"""\n\nMerge them into ONE consolidated entry.`;
}

export function reviewMergePrompt(memos: MergeSource[]): string {
  const listed = memos
    .map((m, i) => `Memo ${i + 1} · ${m.type} · saved ${m.createdAt.toISOString().slice(0, 10)}:\n"""\n${m.title}\n${m.content}\n"""`)
    .join("\n\n");
  return `A person reviewing the project's memory found these memos about the same thing, oldest first:\n\n${listed}\n\nWrite the ONE memo that replaces them all.`;
}
