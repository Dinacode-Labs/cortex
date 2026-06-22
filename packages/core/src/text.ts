import type { ContextEntryType, EntityType } from "@cortex/shared";

/**
 * Heurísticas locales (sin LLM) para clasificar y enriquecer conocimiento.
 * Son un respaldo deliberadamente simple: los agentes Mastra (con LLM) deben
 * mejorar esto en fases posteriores. Documentado en docs/decisions.md (ADR-0005/6).
 */

/** Normaliza un nombre a su forma canónica: minúsculas, sin acentos, sin espacios extra. */
export function canonicalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Deriva un título corto si el usuario no lo dio: primera frase, recortada. */
export function deriveTitle(content: string): string {
  const firstLine = content.trim().split(/\r?\n/)[0] ?? content.trim();
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const title = firstSentence.trim();
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

/** Resumen heurístico: primera(s) frase(s) hasta ~240 caracteres. */
export function summarize(content: string): string {
  const text = content.trim().replace(/\s+/g, " ");
  if (text.length <= 240) return text;
  const cut = text.slice(0, 240);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trim()}...`;
}

// Reglas de clasificación en orden de prioridad (más específicas primero).
const CLASSIFY_RULES: { type: ContextEntryType; re: RegExp }[] = [
  { type: "constraint", re: /\b(restricci|no (puede|permite|admite|podemos)|exige|pol[ií]tica|prohib|requisito|debe desplegarse|constraint|no se permite)/i },
  { type: "incident", re: /\b(error|fallo|bug|incidencia|ca[ií]d|se rompe|crash|incident|defecto)/i },
  { type: "technical_debt", re: /\b(deuda t[eé]cnica|legacy|refactor|technical debt|tech debt|c[oó]digo heredado)/i },
  { type: "convention", re: /\b(convenci[oó]n|convention|est[aá]ndar|naming|estilo de c[oó]digo|coding style)/i },
  { type: "risk", re: /\b(riesgo|risk|peligro|sensible|cuidado al)/i },
  { type: "architecture", re: /\b(arquitectura|architecture|patr[oó]n|microservi|monolito|capa de)/i },
  { type: "integration_note", re: /\b(integraci[oó]n|integration|api externa|webhook|proveedor externo)/i },
  { type: "business_rule", re: /\b(regla de negocio|business rule|se factura|se calcula el|tarifa)/i },
  { type: "how_to", re: /\b(c[oó]mo (se|configurar|hacer)|how to|pasos para|gu[ií]a para)/i },
  { type: "decision", re: /\b(decid|elig|optamos|se va a|usaremos|mantener|decisi[oó]n|decision|acordamos)/i },
];

/** Clasificación heurística del tipo de entrada. Por defecto: module_note. */
export function classifyType(content: string): ContextEntryType {
  for (const rule of CLASSIFY_RULES) {
    if (rule.re.test(content)) return rule.type;
  }
  return "module_note";
}

// Diccionario mínimo de tecnologías reconocibles.
const TECHNOLOGIES = [
  "laravel", "symfony", "vue", "react", "angular", "node", "nestjs", "next",
  "postgres", "postgresql", "mysql", "mariadb", "redis", "kafka", "rabbitmq",
  "docker", "kubernetes", "oauth", "jwt", "graphql", "rest", "stripe", "paypal",
  "aws", "gcp", "azure", "qdrant", "pgvector", "mastra", "mcp", "typescript",
  "php", "python", "elasticsearch", "mongodb",
];

// Módulos/áreas funcionales habituales (ES) que merece la pena reconocer.
const MODULE_KEYWORDS = [
  "facturaci[oó]n", "autenticaci[oó]n", "pagos", "billing", "auth", "payments",
  "usuarios", "notificaciones", "reporting", "documentos", "checkout",
];

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}

/** Extrae entidades (tecnologías y módulos) mencionadas en el texto. Heurístico. */
export function extractEntities(content: string): ExtractedEntity[] {
  const found = new Map<string, ExtractedEntity>();
  const lower = content.toLowerCase();

  for (const tech of TECHNOLOGIES) {
    const re = new RegExp(`\\b${tech}\\b`, "i");
    if (re.test(lower)) found.set(`technology:${tech}`, { name: tech, type: "technology" });
  }
  for (const mod of MODULE_KEYWORDS) {
    const re = new RegExp(`\\b${mod}\\b`, "i");
    const m = lower.match(re);
    if (m) found.set(`module:${m[0]}`, { name: m[0], type: "module" });
  }
  return [...found.values()];
}

/**
 * Etiquetas de "polaridad" para detección heurística de contradicciones (§12.5).
 * Dos entradas muy similares con etiquetas opuestas en un mismo eje se marcan
 * como posible contradicción.
 */
export function polarityTags(content: string): Set<string> {
  const tags = new Set<string>();
  const t = content.toLowerCase();
  // Eje conservar vs eliminar/migrar
  if (/\b(mantener|conservar|no migrar|no eliminar|seguir usando|no tocar)\b/.test(t)) tags.add("keep");
  if (/\b(eliminar|migrar|quitar|retirar|deprecar|borrar|reemplazar)\b/.test(t)) tags.add("remove");
  // Eje on-prem vs cloud
  if (/\b(infraestructura propia|on-?prem|servidores propios)\b/.test(t)) tags.add("onprem");
  if (/\b(cloud p[uú]blico|proveedor cloud|nube p[uú]blica)\b/.test(t)) tags.add("cloud");
  return tags;
}

const OPPOSING_AXES: [string, string][] = [
  ["keep", "remove"],
  ["onprem", "cloud"],
];

/** ¿Los dos conjuntos de polaridad se contradicen en algún eje? */
export function polarityContradicts(a: Set<string>, b: Set<string>): boolean {
  return OPPOSING_AXES.some(([x, y]) => (a.has(x) && b.has(y)) || (a.has(y) && b.has(x)));
}
