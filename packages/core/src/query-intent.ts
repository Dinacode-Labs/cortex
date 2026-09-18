import type { ContextEntryType } from "@cortex/shared";

/**
 * When the question names a domain category, infer it.
 *
 * The eval surfaced this: "what technical debt is there around billing?" retrieved 0 out of 2,
 * and all five results were about billing without any of them being technical debt. Semantic
 * similarity swallows the type, because "technical debt" contributes far less to the embedding
 * than "billing" does.
 *
 * It is used as a NUDGE, not as a filter (see `searchContext`). Filtering would be worse than
 * doing nothing: someone asking "what did we decide about retries?" may have the answer stored
 * as a constraint, and a filter would make it vanish. A nudge only changes the order when the
 * topic ties, which is exactly the failing case.
 *
 * The patterns are deliberately short and explicit: category names only. Including "how..."
 * for `how_to` was tried and did harm, because half the questions start that way. `core` uses
 * no LLM (ADR-0002), so this is a table, not a classifier.
 *
 * The Spanish alternatives are there because the corpus is Spanish; they match what users
 * type, not the language of this file.
 */

const PATTERNS: [RegExp, ContextEntryType][] = [
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
 * The type the question names, or `null` when it names none -- which is the normal case.
 * The first matching pattern wins: they run from most specific to least, because "technical
 * debt" also contains words that could sound like something else.
 */
export function inferTypeFromQuery(query: string): ContextEntryType | null {
  for (const [pattern, type] of PATTERNS) if (pattern.test(query)) return type;
  return null;
}
