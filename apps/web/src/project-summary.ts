import { html } from "hono/html";
import { latestProjectHealth, type HealthSnapshot } from "@cortex/core";
import type { Html } from "./views/layout.js";

/**
 * A card shows the last lint, never a fresh one: the projects page used to lint every project on
 * every view, and one lint of a large project takes seconds (ADR-0089).
 * Every lint records it: the Health tab, the MCP tool and the scheduled maintenance.
 */
export async function projectHealths(projects: { id: string }[]): Promise<Map<string, Html>> {
  const latest = await latestProjectHealth(projects.map((p) => p.id));
  return new Map(projects.map((p) => [p.id, healthBadge(latest.get(p.id))]));
}

function healthBadge(snapshot: HealthSnapshot | undefined): Html {
  if (!snapshot) return html`<span class="health unchecked">not checked yet</span>`;
  const checked = `Checked ${snapshot.checkedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const warnings = snapshot.contradictions + snapshot.duplicates;
  if (warnings === 0) return html`<span class="health ok" title="${checked}">✓ healthy</span>`;
  return html`<span class="health warn" title="${checked}">${warnings} to review</span>`;
}
