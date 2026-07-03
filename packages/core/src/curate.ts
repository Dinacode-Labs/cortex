import { getSql } from "@cortex/database";
import type { Row } from "./map.js";

/**
 * Auto-curación SIN humano (sustituye al "review" para no añadir fricción; ver
 * research/memory-capture-policy.md). Sobre el conocimiento AUTO-capturado
 * (`source_type = 'agent_session'`, confianza baja — el filtro va por origen, no por
 * autor: la captura autenticada firma con el email del usuario):
 *  - PROMUEVE a confianza media lo CORROBORADO: entradas que se reforzaron/fusionaron
 *    DESPUÉS de crearse (updated_at avanzó → recurrió en otra sesión).
 *  - DECAE lo viejo nunca corroborado: auto-capturado, sin fusiones, más antiguo que
 *    CORTEX_DECAY_DAYS → status `obsolete` (sale de la búsqueda; reversible).
 * No toca conocimiento curado/validado ni de otras fuentes.
 */
export interface CurationResult {
  promoted: number;
  decayed: number;
}

export async function autoCurate(decayDays = Number(process.env.CORTEX_DECAY_DAYS ?? "120")): Promise<CurationResult> {
  const sql = getSql();
  const promoted = (await sql`
    UPDATE context_entries SET confidence = 'medium'
    WHERE confidence = 'low' AND source_type = 'agent_session'
      AND status = 'pending_validation' AND valid_to IS NULL
      AND updated_at > created_at + interval '1 minute'
    RETURNING id
  `) as unknown as Row[];
  const decayed = (await sql`
    UPDATE context_entries SET status = 'obsolete'
    WHERE confidence = 'low' AND source_type = 'agent_session'
      AND status = 'pending_validation' AND valid_to IS NULL
      AND updated_at <= created_at + interval '1 minute'
      AND created_at < now() - make_interval(days => ${decayDays})
    RETURNING id
  `) as unknown as Row[];
  return { promoted: promoted.length, decayed: decayed.length };
}
