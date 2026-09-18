import { closeSql, getSql } from "@cortex/database";
import { applyTemporalInvalidation, autoCurate, lintProject, listProjects, reclassifyProject, reconcileProject, resolveEntities } from "@cortex/core";
import { enrichProject } from "./enrich-project.js";
import { shutdownObservability } from "./mastra.js";

/**
 * Cortex's MAINTENANCE pipeline (the loops of section 12), meant to run periodically on the
 * server (see maintain-worker / cron). It chains, idempotently:
 *   1) reclassify (heuristic types -> LLM)   2) enrich (only-missing) per project
 *   3) resolve-entities (global)             4) temporal invalidation (global)
 *   5) curate + reconcile per project        6) lint (health) per project
 *
 * **Source sync does NOT belong here**: the developer triggers it by hand (they have the
 * context and the judgement). This is maintenance only, which happens entirely on the server.
 *
 * An exclusion lock (an advisory lock on a reserved connection) keeps runs from overlapping.
 *
 * CLI usage: tsx src/maintain.ts ["<Project>"]   (no argument = every project)
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
      console.log("[maintain] another maintenance run is in progress (lock not acquired) -- skipping.");
      return { ran: false, projects: [], enriched: {}, merged: 0, historical: 0, superseded: 0, promoted: 0, decayed: 0, deduped: 0, reclassified: 0 };
    }

    const projects = only ? [only] : (await listProjects()).map((p) => p.entity.name);
    console.log(`[maintain] ${projects.length} project(s): ${projects.join(", ")}`);

    // Deferred reclassification: uses the LLM to fix the heuristic types of what the
    // connectors ingested (decisions/constraints/risks), without re-ingesting. It runs before
    // enrich/lint so the graph and the "gaps" are computed over correct types.
    let reclassified = 0;
    for (const p of projects) {
      const rc = await reclassifyProject(p);
      reclassified += rc.reclassified;
      if (rc.reclassified) console.log(`  [reclassify] ${p}: ${rc.reclassified}/${rc.scanned} re-typed with the LLM`);
    }

    const enriched: Record<string, number> = {};
    for (const p of projects) {
      const r = await enrichProject(p, { onlyMissing: true });
      enriched[p] = r.entities;
      console.log(`  [enrich] ${p}: ${r.processed} new → +${r.entities} ent, +${r.relations} rel (${r.skipped} already done, ${r.failed} failed)`);
    }

    const res = await resolveEntities();
    console.log(`  [resolve] ${res.merged} variants merged (${res.groups} groups)`);

    const t = await applyTemporalInvalidation();
    console.log(`  [temporal] ${t.historical} marked historical, ${t.superseded} superseded`);

    // Auto-curation (no human): it promotes what was corroborated and decays the old and never corroborated.
    const c = await autoCurate();
    console.log(`  [curate] ${c.promoted} promoted (corroborated), ${c.decayed} decayed (obsolete)`);

    // After-the-fact reconciliation: dedup of near-identical entries (including what the
    // connectors ingested), reusing embeddings. Before the lint so it reports the clean state.
    let deduped = 0;
    for (const p of projects) {
      const d = await reconcileProject(p);
      deduped += d.deduped;
      if (d.deduped) console.log(`  [reconcile] ${p}: ${d.deduped} near-identical entries deduplicated`);
    }

    for (const p of projects) {
      const l = await lintProject(p);
      console.log(`  [lint] ${p}: ${l.contradictions.length} contradictions · ${l.gaps.length} gaps · ${l.duplicates.length} dups · ${l.orphanEntities.length} orphans · ${l.lowConfidence} low-confidence`);
    }

    console.log("[maintain] done.");
    return { ran: true, projects, enriched, merged: res.merged, historical: t.historical, superseded: t.superseded, promoted: c.promoted, decayed: c.decayed, deduped, reclassified };
  } finally {
    if (locked) { try { await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`; } catch { /* best-effort */ } }
    await conn.release();
  }
}
