import { port } from "../../composition.js";
import { findProjectIdByName } from "../../projects/application/projects.js";
import { DUPLICATE_DISTANCE, GAP_MIN_INCIDENTS, type HealthSnapshot, type LintReport } from "../domain/health.js";

export type { HealthSnapshot, LintReport } from "../domain/health.js";

export async function lintProject(project: string): Promise<LintReport> {
  const pid = await findProjectIdByName(project);
  if (!pid) throw new Error(`Project not found: "${project}".`);
  const health = port("health");
  const [totalEntries, contradictions, duplicates, orphanEntities, lowConfidence, staleHistorical, neverReviewed, gaps] =
    await Promise.all([
      health.currentCount(pid),
      health.contradictions(pid, 50),
      health.likelyDuplicates(pid, DUPLICATE_DISTANCE, 25),
      health.orphanEntities(pid, 40),
      health.lowConfidenceCount(pid),
      health.historicalCount(pid),
      health.neverReviewedCount(pid),
      health.incidentGaps(pid, GAP_MIN_INCIDENTS, 15),
    ]);
  await port("healthSnapshots").record(pid, { contradictions: contradictions.length, duplicates: duplicates.length });
  return {
    project,
    totalEntries,
    contradictions,
    duplicates,
    orphanEntities,
    lowConfidence,
    staleHistorical,
    neverReviewed,
    gaps,
  };
}

/** By project id; a project never linted is missing from the map. */
export async function latestProjectHealth(projectIds: string[]): Promise<Map<string, HealthSnapshot>> {
  return port("healthSnapshots").latest(projectIds);
}

export function renderLintReport(r: LintReport): string {
  const L: string[] = [`# Lint — ${r.project}`, `_${r.totalEntries} ${r.totalEntries === 1 ? "entry" : "entries"}_`, ""];
  L.push(`## ⚠️ Contradictions (${r.contradictions.length})`);
  L.push(...(r.contradictions.length ? r.contradictions.map((c) => `- ${c.a}  ⟷  ${c.b}`) : ["- (none)"]));
  L.push("", `## 🔁 Likely duplicates (${r.duplicates.length})`);
  L.push(...(r.duplicates.length ? r.duplicates.map((d) => `- (${d.score.toFixed(2)}) ${d.a}  ≈  ${d.b}`) : ["- (none)"]));
  L.push("", `## 🕳️ Gaps: areas with incidents but no decisions (${r.gaps.length})`);
  L.push(...(r.gaps.length ? r.gaps.map((g) => `- ${g.area} (${g.type}): ${g.incidents} incidents, 0 decisions`) : ["- (none)"]));
  L.push("", `## 🧩 Orphan entities (${r.orphanEntities.length})`);
  L.push(...(r.orphanEntities.length ? r.orphanEntities.slice(0, 20).map((e) => `- ${e.type}: ${e.name}`) : ["- (none)"]));
  L.push(
    "",
    `## 📉 Other`,
    `- Never reviewed by a person: ${r.neverReviewed} of ${r.totalEntries}`,
    `- Low confidence: ${r.lowConfidence}`,
    `- Superseded or obsolete: ${r.staleHistorical}`,
  );
  return L.join("\n");
}
