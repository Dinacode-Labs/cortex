import type { Memo } from "./memo.js";

/** What the editing agent proposes for a memo nobody has checked yet (ADR-0099). Never applied on its own. */
export type MemoSuggestion =
  | { kind: "rewrite"; title: string; content: string; reason: string }
  | { kind: "reject"; reason: string };

export type EditSource = Pick<Memo, "id" | "title" | "content" | "type" | "createdAt" | "sourceType">;

export interface MemoSuggestionStore {
  /** Null when there is none, there was nothing to suggest, or the memo changed since. */
  find(memo: Memo): Promise<MemoSuggestion | null>;
  /** Looked at as the memo reads now, whatever came of it. */
  tried(memo: Memo): Promise<boolean>;
  /** Null records that there was nothing to suggest. */
  save(projectId: string, memo: Memo, suggestion: MemoSuggestion | null): Promise<void>;
}

/** A rewrite that changes nothing is no suggestion: it would only cost a person's reading. */
export function changesSomething(memo: Pick<Memo, "title" | "content">, suggestion: MemoSuggestion): boolean {
  if (suggestion.kind === "reject") return true;
  return suggestion.title.trim() !== memo.title.trim() || suggestion.content.trim() !== memo.content.trim();
}
