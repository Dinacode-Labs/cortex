import { contextEntryType } from "@cortex/shared";

const TYPES = contextEntryType.options as readonly string[];

export function distillerPrompt(project: string, window: string): string {
  return `Project: "${project}". A transcript window from an AI agent session working on this project:
"""
${window}
"""
Extract ONLY the DURABLE, reusable knowledge as JSON:
{"items":[{"type": one of [${TYPES.join(", ")}], "title": "a short title", "content": "the knowledge in 1-3 sentences", "summary": "one sentence that does NOT repeat the title"}]}
Include technical decisions, constraints, incidents and how they were resolved, conventions, technical debt, risks and how-tos. DISCARD noise (tool calls, file dumps, narration, greetings, abandoned attempts). NEVER include secrets or keys. When nothing is worth keeping, return {"items":[]}.`;
}
