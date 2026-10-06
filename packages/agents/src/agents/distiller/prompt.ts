import { contextEntryType, type ProjectCriteria } from "@cortex/shared";
import { describeMemoTypes } from "../memo-types.js";
import { keepsType } from "@cortex/core";

function projectLists(criteria?: ProjectCriteria): string {
  const lines = [
    criteria?.keep.length ? `This project always keeps: ${criteria.keep.join("; ")}.` : "",
    criteria?.discard.length ? `This project never keeps: ${criteria.discard.join("; ")}.` : "",
  ].filter(Boolean);
  return lines.length ? `\n${lines.join("\n")}` : "";
}

export function distillerPrompt(project: string, window: string, criteria?: ProjectCriteria): string {
  const types = contextEntryType.options.filter((type) => !criteria || keepsType(criteria, type));
  return `Project: "${project}". A transcript window from an AI agent session working on this project:
"""
${window}
"""
Extract ONLY the DURABLE, reusable knowledge as JSON:
{"items":[{"type": one of the types below, "title": "a short title", "content": "the knowledge in 1-3 sentences", "summary": "one sentence that does NOT repeat the title"}]}
Types:
${describeMemoTypes(types, criteria)}${projectLists(criteria)}
Include technical decisions, constraints, incidents and how they were resolved, conventions, technical debt, risks and how-tos. DISCARD noise (tool calls, file dumps, narration, greetings, abandoned attempts). NEVER include secrets or keys. When nothing is worth keeping, return {"items":[]}.`;
}
