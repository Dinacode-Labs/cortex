import { html } from "hono/html";
import { lintProject } from "@cortex/core";
import type { Html } from "./views/layout.js";

/**
 * When the lint fails, the card is painted without it: not knowing whether it is healthy is no
 * reason to be unable to pick the project.
 */
export async function projectHealth(name: string): Promise<Html> {
  try {
    const r = await lintProject(name);
    const warnings = r.contradictions.length + r.duplicates.length;
    if (warnings === 0) return html`<span class="health ok">✓ healthy</span>`;
    return html`<span class="health warn">${warnings} to review</span>`;
  } catch {
    return html``;
  }
}
