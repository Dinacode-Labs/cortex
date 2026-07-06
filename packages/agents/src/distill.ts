import { contextEntryType } from "@cortex/shared";
import { runAgent } from "./mastra.js";

/**
 * Destilación LLM de un fragmento de transcript de sesión → conocimiento TIPADO
 * (decisiones/restricciones/incidencias/convenciones…). No ingiere el transcript crudo:
 * extrae solo lo DURADERO y reutilizable, descartando ruido. Es la parte "inteligente"
 * del pipeline de captura de sesiones.
 */

const TYPES = contextEntryType.options as readonly string[];

export interface Item { type: string; title: string; content: string }

function extractJson(raw: string): string {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  return s >= 0 && e > s ? raw.slice(s, e + 1) : raw;
}

export async function distill(project: string, window: string): Promise<Item[]> {
  const prompt = `Proyecto: "${project}". Fragmento de transcript de una sesión de un agente de IA trabajando en este proyecto:
"""
${window}
"""
Extrae SOLO el conocimiento DURADERO y reutilizable como JSON:
{"items":[{"type": uno de [${TYPES.join(", ")}], "title": "título corto", "content": "el conocimiento en 1-3 frases"}]}
Incluye decisiones técnicas, restricciones, incidencias y su resolución, convenciones, deuda técnica, riesgos y how-tos. DESCARTA ruido (llamadas a herramientas, volcados de ficheros, narración, saludos, intentos abandonados). NUNCA incluyas secretos/claves. Si no hay nada que valga, devuelve {"items":[]}.`;
  try {
    const raw = await runAgent("distiller", prompt, { maxOutputTokens: 1500 });
    const parsed = JSON.parse(extractJson(raw)) as { items?: { type?: string; title?: string; content?: string }[] };
    return (parsed.items ?? [])
      .filter((i): i is Item => Boolean(i?.title && i?.content))
      .map((i) => ({ type: TYPES.includes(i.type ?? "") ? (i.type as string) : "module_note", title: i.title.trim().slice(0, 160), content: i.content.trim() }));
  } catch (e) {
    console.error(`  ✗ destilación falló en una ventana: ${(e as Error).message}`);
    return [];
  }
}
