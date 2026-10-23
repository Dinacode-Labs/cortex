import type { Language } from "@cortex/shared";
import { isGroupRelation, type JudgedGroup, type JudgeSource } from "@cortex/core";
import { extractJson } from "../../json.js";
import { runAgent } from "../../runtime/run-agent.js";
import { judgePrompt } from "./prompt.js";

const MAX_REASON_CHARS = 300;

/** The nightly pass's question (ADR-0098): which of the memos that read alike belong in one review with the memo of the day. */
export async function judgeGroups(
  memo: JudgeSource,
  alike: JudgeSource[],
  context: { language: Language; projectId: string },
): Promise<JudgedGroup[] | null> {
  const { language, projectId } = context;
  const answer = await runAgent("judge", judgePrompt(memo, alike), { maxOutputTokens: 600, language, projectId });
  return parseGroups(answer, [memo, ...alike].map((m) => m.id));
}

/**
 * Null when the answer is not the contract's shape, so the pass falls back to similarity. A group
 * that leaves memo 0 out, or names a number nobody was shown, is dropped rather than guessed at.
 */
export function parseGroups(answer: string, ids: string[]): JudgedGroup[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(answer));
  } catch {
    return null;
  }
  const groups = (parsed as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return null;
  const judged: JudgedGroup[] = [];
  for (const group of groups as { memos?: unknown; relation?: unknown; reason?: unknown }[]) {
    if (!Array.isArray(group?.memos) || !isGroupRelation(group.relation)) continue;
    const shownIndexes = [...new Set(group.memos)].filter((i): i is number => Number.isInteger(i) && i >= 0 && i < ids.length);
    if (!shownIndexes.includes(0) || shownIndexes.length < 2) continue;
    const reason = typeof group.reason === "string" ? group.reason.trim().slice(0, MAX_REASON_CHARS) : "";
    judged.push({ memoIds: shownIndexes.map((i) => ids[i]!), relation: group.relation, reason });
  }
  return judged;
}
