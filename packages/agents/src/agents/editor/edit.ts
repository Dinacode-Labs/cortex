import type { Language, ProjectCriteria } from "@cortex/shared";
import type { EditSource, MemoSuggestion } from "@cortex/core";
import { extractJson } from "../../json.js";
import { runAgent } from "../../runtime/run-agent.js";
import { editorPrompt } from "./prompt.js";

const MAX_REASON_CHARS = 300;

/** The nightly pass's question for a memo nobody has checked yet (ADR-0099): rewrite it, reject it, or leave it. */
export async function suggestEdit(
  memo: EditSource,
  context: { language: Language; projectId: string; criteria: ProjectCriteria },
): Promise<MemoSuggestion | null> {
  const { language, projectId, criteria } = context;
  return parseSuggestion(await runAgent("editor", editorPrompt(memo, criteria), { maxOutputTokens: 900, language, projectId }));
}

/** Null for "none" and for anything that is not the contract's shape: a memo is never rewritten into nothing. */
export function parseSuggestion(answer: string): MemoSuggestion | null {
  let parsed: { suggestion?: unknown; reason?: unknown; title?: unknown; content?: unknown };
  try {
    parsed = JSON.parse(extractJson(answer)) ?? {};
  } catch {
    return null;
  }
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const reason = text(parsed.reason).slice(0, MAX_REASON_CHARS);
  if (parsed.suggestion === "reject") return reason ? { kind: "reject", reason } : null;
  if (parsed.suggestion !== "rewrite") return null;
  const title = text(parsed.title);
  const content = text(parsed.content);
  return title && content ? { kind: "rewrite", title, content, reason } : null;
}
