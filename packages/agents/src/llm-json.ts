/**
 * Utilidad compartida para recuperar el JSON de una respuesta LLM.
 * Los modelos a veces envuelven el JSON en un bloque cercado ```json ... ```;
 * priorizamos ese bloque y, si no lo hay, recortamos desde la primera `{` hasta
 * la última `}`.
 */

/** Extrae el primer bloque JSON de una respuesta LLM (tolera fences ```json). */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}
