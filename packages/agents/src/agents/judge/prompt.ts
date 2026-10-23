import type { JudgeSource } from "@cortex/core";

// Twelve neighbours that are each a long document chunk would fill the window for one memo.
const MAX_CHARS_PER_MEMO = 1500;

function shown(index: number, memo: JudgeSource): string {
  const content = memo.content.length > MAX_CHARS_PER_MEMO ? `${memo.content.slice(0, MAX_CHARS_PER_MEMO)}…` : memo.content;
  return `[${index}] ${memo.type} · saved ${memo.createdAt.toISOString().slice(0, 10)}:\n"""\n${memo.title}\n${content}\n"""`;
}

export function judgePrompt(memo: JudgeSource, alike: JudgeSource[]): string {
  return (
    `The memo of the day:\n\n${shown(0, memo)}\n\n` +
    `Other memos of this project, the closest first:\n\n${alike.map((m, i) => shown(i + 1, m)).join("\n\n")}\n\n` +
    "Which of them go in one review with [0]?"
  );
}
