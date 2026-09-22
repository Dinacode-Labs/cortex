/**
 * Shared utility for recovering the JSON from an LLM response.
 * Models sometimes wrap the JSON in a ```json ... ``` fenced block; that block takes priority
 * and, failing that, the text is trimmed from the first `{` to the last `}`.
 */

export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}
