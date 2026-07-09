import { closeSql, getSql } from "@cortex/database";
import { applyTemporalInvalidation, autoCurate, lintProject, listProjects, reclassifyProject, reconcileProject, resolveEntities } from "@cortex/core";
import { enrichProject } from "./enrich-project.js";
import { shutdownObservability } from "./mastra.js";

/**
 * Pipeline de MANTENIMIENTO de Cortex (loops §12), pensado para ejecutarse en server
 * de forma periódica (ver maintain-worker / cron). Encadena, de forma idempotente:
 *   1) reclassify (tipos heurísticos → LLM)  2) enrich (only-missing) por proyecto
 *   3) resolve-entities (global)             4) invalidación temporal (global)
 *   5) curate + reconcile por proyecto        6) lint (salud) por proyecto
 *
 * El **sync de fuentes NO va aquí**: lo dispara el developer manualmente (tiene su
 * contexto/criterio). Esto es solo mantenimiento, que ocurre 100% en server.
 *
 * Lock de exclusión (advisory lock en conexión reservada) para no solapar ejecuciones.
 *
 * Uso CLI: tsx src/maintain.ts ["<Proyecto>"]   (sin arg = todos los proyectos)
 */

const LOCK_KEY = 4242421;

export interface MaintenanceReport {
  ran: boolean;
  projects: string[];
  enriched: Record<string, number>;
  merged: number;
  historical: number;
  superseded: number;
  promoted: number;
  decayed: number;
  deduped: number;
  reclassified: number;
}

export async function runMaintenance(only?: string): Promise<MaintenanceReport> {
  const sql = getSql();
  const conn = await sql.reserve();
  let locked = false;
  try {
    const rows = (await conn`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`) as unknown as { locked: boolean }[];
    locked = rows[0]?.locked === true;
    if (!locked) {
      console.log("[maintain] otro mantenimiento en curso (lock no adquirido) — saltando.");
      return { ran: false, projects: [], enriched: {}, merged: 0, historical: 0, superseded: 0, promoted: 0, decayed: 0, deduped: 0, reclassified: 0 };
    }

    const projects = only ? [only] : (await listProjects()).map((p) => p.entity.name);
    console.log(`[maintain] ${projects.length} proyecto(s): ${projects.join(", ")}`);

    // Reclasificación diferida: arregla con el LLM los tipos heurísticos de lo ingerido
    // por conectores (decisiones/constraints/riesgos), sin re-ingerir. Antes de enrich/lint
    // para que el grafo y los "huecos" se calculen sobre tipos correctos.
    let reclassified = 0;
    for (const p of projects) {
      const rc = await reclassifyProject(p);
      reclassified += rc.reclassified;
      if (rc.reclassified) console.log(`  [reclassify] ${p}: ${rc.reclassified}/${rc.scanned} re-tipadas con LLM`);
    }

    const enriched: Record<string, number> = {};
    for (const p of projects) {
      const r = await enrichProject(p, { onlyMissing: true });
      enriched[p] = r.entities;
      console.log(`  [enrich] ${p}: ${r.processed} nuevas → +${r.entities} ent, +${r.relations} rel (${r.skipped} ya, ${r.failed} fallos)`);
    }

    const res = await resolveEntities();
    console.log(`  [resolve] ${res.merged} variantes fusionadas (${res.groups} grupos)`);

    const t = await applyTemporalInvalidation();
    console.log(`  [temporal] ${t.historical} históricas, ${t.superseded} superadas`);

    // Auto-curación (sin humano): promueve lo corroborado, decae lo viejo nunca corroborado.
    const c = await autoCurate();
    console.log(`  [curate] ${c.promoted} promovidas (corroboradas), ${c.decayed} decaídas (obsoletas)`);

    // Reconciliación a posteriori: dedup de near-idénticos (incl. lo ingerido por
    // conectores), reusando embeddings. Antes del lint para que reporte el estado limpio.
    let deduped = 0;
    for (const p of projects) {
      const d = await reconcileProject(p);
      deduped += d.deduped;
      if (d.deduped) console.log(`  [reconcile] ${p}: ${d.deduped} near-idénticos deduplicados`);
    }

    for (const p of projects) {
      const l = await lintProject(p);
      console.log(`  [lint] ${p}: ${l.contradictions.length} contradicciones · ${l.gaps.length} huecos · ${l.duplicates.length} dups · ${l.orphanEntities.length} huérfanas · ${l.lowConfidence} baja-conf`);
    }

    console.log("[maintain] completado.");
    return { ran: true, projects, enriched, merged: res.merged, historical: t.historical, superseded: t.superseded, promoted: c.promoted, decayed: c.decayed, deduped, reclassified };
  } finally {
    if (locked) { try { await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`; } catch { /* best-effort */ } }
    await conn.release();
  }
}
