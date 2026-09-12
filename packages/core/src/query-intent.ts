import type { ContextEntryType } from "@cortex/shared";

/**
 * Cuando la pregunta nombra una categoría del dominio, deducirla.
 *
 * Lo sacó el eval: «¿Qué deuda técnica hay alrededor de la facturación?» recuperaba 0 de 2, y
 * los cinco resultados hablaban de facturación sin que ninguno fuera deuda técnica. La
 * similitud semántica se come el tipo, porque «deuda técnica» aporta muchísimo menos al
 * embedding que «facturación».
 *
 * Se usa como EMPUJÓN, no como filtro (ver `searchContext`). Filtrar sería peor que no hacer
 * nada: quien pregunta «¿qué decidimos sobre los reintentos?» puede tener la respuesta
 * guardada como restricción, y un filtro la haría desaparecer. Empujar solo cambia el orden
 * cuando hay empate de tema, que es exactamente el caso que falla.
 *
 * Los patrones son deliberadamente cortos y explícitos: solo nombres de categoría. Se probó
 * incluir «cómo…» para `how_to` y hacía daño, porque media pregunta en español empieza así.
 * `core` no usa LLM (ADR-0002), así que esto es una tabla, no un clasificador.
 */

const PATRONES: [RegExp, ContextEntryType][] = [
  [/\bdeuda[s]?\s+t[eé]cnica[s]?\b|\btechnical\s+debt\b/i, "technical_debt"],
  [/\bregla[s]?\s+de\s+negocio\b|\bbusiness\s+rule[s]?\b/i, "business_rule"],
  [/\bdecisi[oó]n(es)?\b|\bdecision[s]?\b/i, "decision"],
  [/\brestricci[oó]n(es)?\b|\bconstraint[s]?\b/i, "constraint"],
  [/\bincidencia[s]?\b|\bincidente[s]?\b|\bincident[s]?\b|\bpostmortem\b/i, "incident"],
  [/\briesgo[s]?\b|\brisk[s]?\b/i, "risk"],
  [/\bconvenci[oó]n(es)?\b|\bconvention[s]?\b/i, "convention"],
  [/\barquitectura\b|\barchitecture\b/i, "architecture"],
];

/**
 * El tipo que la pregunta nombra, o `null` si no nombra ninguno —que es lo normal—.
 * El primer patrón que casa gana: van de más específico a menos, porque «deuda técnica»
 * también contiene palabras que podrían sonar a otra cosa.
 */
export function inferTypeFromQuery(query: string): ContextEntryType | null {
  for (const [patron, tipo] of PATRONES) if (patron.test(query)) return tipo;
  return null;
}
