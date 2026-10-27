import { getEnvNum, scrub, type Language, type ProjectCriteria } from "@cortex/shared";
import { port } from "../../composition.js";
import { criteriaOfProject, languageOfProject } from "../../projects/application/projects.js";
import type { Memo } from "../domain/memo.js";
import { changesSomething, type EditSource, type MemoSuggestion } from "../domain/memo-suggestion.js";
import { CHECK_ORDER } from "./verification-queue.js";

/**
 * Null when it reads well as it is, or the answer could not be read. A throw -- the provider down --
 * leaves the memo to be asked about the next night.
 */
export type MemoEditor = (memo: EditSource, context: { language: Language; projectId: string; criteria: ProjectCriteria }) => Promise<MemoSuggestion | null>;

/** The next memos of the lane, the ones a person reaches first, not every memo waiting (ADR-0099). */
export const SUGGESTIONS_PER_NIGHT = getEnvNum("CORTEX_SWEEP_MAX_SUGGESTIONS", 30);

let editor: MemoEditor | null = null;

export function setMemoEditor(fn: MemoEditor | null): void {
  editor = fn;
}

// The model's words are shown later and may become the memo's, so they are scrubbed like any text coming in.
function scrubbed(suggestion: MemoSuggestion): MemoSuggestion {
  const reason = scrub(suggestion.reason);
  return suggestion.kind === "reject" ? { kind: "reject", reason } : { kind: "rewrite", reason, title: scrub(suggestion.title), content: scrub(suggestion.content) };
}

/**
 * A memo the nightly pass grouped with others is left out: merging them is the better rewrite,
 * and two proposals for one memo would contradict each other.
 */
async function worthAsking(projectId: string, memo: Memo): Promise<boolean> {
  if (await port("memoSuggestions").tried(memo)) return false;
  const queue = port("reviewQueue");
  return !(await queue.isPending(projectId, memo.id)) && (await queue.raisedBy(projectId, memo.id)).length === 0;
}

/** Returns how many memos it found something to suggest for. */
export async function suggestEdits(projectId: string, ahead = SUGGESTIONS_PER_NIGHT): Promise<number> {
  if (!editor || ahead <= 0) return 0;
  const upcoming = await port("verificationQueue").upcoming(projectId, CHECK_ORDER, ahead);
  const memos: Memo[] = [];
  for (const memo of upcoming) if (await worthAsking(projectId, memo)) memos.push(memo);
  if (memos.length === 0) return 0;
  const [{ effective: language }, { effective: criteria }] = await Promise.all([languageOfProject(projectId), criteriaOfProject(projectId)]);
  let suggested = 0;
  for (const memo of memos) {
    let answer: MemoSuggestion | null;
    try {
      answer = await editor(memo, { language, projectId, criteria });
    } catch {
      continue;
    }
    const suggestion = answer && changesSomething(memo, answer) ? scrubbed(answer) : null;
    await port("memoSuggestions").save(projectId, memo, suggestion);
    if (suggestion) suggested++;
  }
  return suggested;
}

/** Only what the nightly pass already wrote: the review screen never waits on a model. */
export async function suggestionFor(memo: Memo): Promise<MemoSuggestion | null> {
  return port("memoSuggestions").find(memo);
}
