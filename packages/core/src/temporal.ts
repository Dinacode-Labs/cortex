import { getSql } from "@cortex/database";
import type { Row } from "./map.js";

/**
 * Invalidación bi-temporal (patrón Zep/Graphiti): cierra la ventana de validez
 * de hechos que han dejado de ser vigentes, en lugar de borrarlos. Así el grafo
 * conserva la historia y soporta consultas point-in-time.
 *
 * Señales usadas (deterministas y reales):
 *  - Estado `Histórico` de Plane (tareas migradas/legacy) → conocimiento no vigente.
 *  - Relaciones `supersedes` entrada→entrada → la entrada superada se cierra.
 *
 * Idempotente: solo toca hechos aún vigentes (valid_to IS NULL).
 */
export async function applyTemporalInvalidation(): Promise<{
  historical: number;
  superseded: number;
}> {
  const sql = getSql();

  const hist = (await sql`
    UPDATE context_entries
    SET valid_to = updated_at, validity = 'historical'
    WHERE metadata->>'state' = 'Histórico' AND valid_to IS NULL
    RETURNING id
  `) as unknown as Row[];

  const sup = (await sql`
    UPDATE context_entries b
    SET valid_to = GREATEST(a.created_at, b.valid_from),
        validity = 'superseded',
        superseded_by = a.id,
        status = CASE WHEN b.status = 'validated' THEN 'superseded' ELSE b.status END
    FROM relations r
    JOIN context_entries a ON a.id = r.source_id
    WHERE r.relation_type = 'supersedes'
      AND b.id = r.target_id
      AND a.id <> b.id
      AND b.valid_to IS NULL
    RETURNING b.id
  `) as unknown as Row[];

  return { historical: hist.length, superseded: sup.length };
}
