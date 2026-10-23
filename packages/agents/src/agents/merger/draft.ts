import type { Language } from "@cortex/shared";
import type { MergeSource } from "@cortex/core";
import { runAgent } from "../../runtime/run-agent.js";
import { reviewMergePrompt } from "./prompt.js";

/** The merge a person asks for in Review (ADR-0096): a draft they edit, never saved on its own. */
export async function draftMerge(
  memos: MergeSource[],
  context: { language: Language; projectId: string | null },
): Promise<{ title: string; content: string } | null> {
  const { language, projectId } = context;
  return splitTitle(await runAgent("merger", reviewMergePrompt(memos), { maxOutputTokens: 900, language, projectId }));
}

/** The contract puts the title on the first line, and a model still dresses it up as a heading now and then. */
export function splitTitle(answer: string): { title: string; content: string } | null {
  const [first = "", ...rest] = answer.trim().split("\n");
  const title = first
    .replace(/^#+\s*/, "")
    .replace(/^title:\s*/i, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .trim();
  const content = rest.join("\n").trim();
  return title && content ? { title, content } : null;
}
