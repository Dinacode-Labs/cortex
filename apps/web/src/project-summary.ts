import { html } from "hono/html";
import { lintProject } from "@cortex/core";
import type { Html } from "./views/layout.js";

/**
 * A project's health at a glance, so nobody has to go in just to find out whether there is
 * anything to look at. It always accompanies the project card, and the card shows up in two
 * places -- the home page and a client's repo list -- so the summary lives outside both.
 *
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
