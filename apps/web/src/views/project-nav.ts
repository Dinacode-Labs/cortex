import { html, raw } from "hono/html";
import type { ProjectRef } from "@cortex/core";
import type { ProjectPage } from "../middleware/access.js";
import type { Html } from "./layout.js";

/**
 * The labels are written for whoever reads them, not for the system's insides: **Health**
 * rather than "Lint", **What agents see** rather than "Context pack". Someone opening the web
 * wants to know whether their memory is healthy and what their agent is being told; "lint" and
 * "pack" are what we call it (ADR-0050).
 */
export type Section = "memory" | "review" | "ask" | "agents" | "health" | "across" | "map" | "code" | "settings";

interface SectionLink {
  id: Section;
  label: string;
  suffix: string;
  icon: string;
}

const ICON_PATHS: Record<Section, string> = {
  memory: '<path d="M8 2 14 5 8 8 2 5Z"/><path d="m2 8 6 3 6-3"/><path d="m2 11 6 3 6-3"/>',
  review: '<path d="M2 9h3l1.5 2h3L11 9h3"/><path d="M3.5 3h9L14 9v4H2V9Z"/>',
  health: '<path d="M1.5 8h3L6 4l3 8 1.5-4h4"/>',
  across:
    '<circle cx="4" cy="3.5" r="1.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="8" cy="12.5" r="1.5"/><path d="M4 5v1.5c0 1.5 4 2 4 4.5M12 5v1.5c0 1.5-4 2-4 4.5"/>',
  ask: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2Z"/>',
  agents: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>',
  map: '<circle cx="3.5" cy="4" r="1.5"/><circle cx="12.5" cy="5" r="1.5"/><circle cx="7" cy="12" r="1.5"/><path d="M5 4.2l6 .6M4.2 5.4l2.1 5.1M11.6 6.3 8 10.9"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  settings:
    '<path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>',
};

const WARNING_PATH = '<path d="M8 2 14.5 13.5h-13Z"/><path d="M8 6.5v3M8 11.5v.1"/>';

const LABELS: Record<Section, string> = {
  memory: "Memory",
  review: "Review",
  ask: "Ask",
  agents: "What agents see",
  health: "Health",
  across: "Across this client",
  map: "Map",
  code: "Code",
  settings: "Settings",
};

const link = (id: Section, suffix: string): SectionLink => ({ id, label: LABELS[id], suffix, icon: ICON_PATHS[id] });

/** `raw()` only over the drawings in this file, never over data. */
function icon(paths: string, size = 16): Html {
  return raw(
    `<svg class="nav-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`,
  );
}

export function visibilityPill(v: "public" | "private"): Html {
  return v === "private"
    ? html`<span class="pill vis private" title="Only its owner, its members and admins can see it">🔒 private</span>`
    : html`<span class="pill vis">public</span>`;
}

/**
 * A child does not make sense on its own: "Acme Portal" is a client's repo, and what the pack
 * tells an agent comes partly from that client. EVERY level is painted, not just the parent,
 * because the hierarchy need not be two deep. The ancestors are always visible to whoever can
 * see the child (`canAccessProject` looks at the whole chain), so there is nothing to filter
 * here.
 */
function crumbs(ancestors: ProjectRef[]): Html {
  if (ancestors.length === 0) return html``;
  return html`<nav class="crumbs" aria-label="Breadcrumb">
    ${ancestors.map(
      (a) => html`${a.slug ? html`<a href="/p/${a.slug}">${a.name}</a>` : html`<span>${a.name}</span>`}<span class="sep">›</span>`,
    )}
  </nav>`;
}

/** The stored snapshot, never a fresh lint: that would cost a duplicate search per click (ADR-0089). */
function healthMark(page: ProjectPage): Html {
  const findings = page.health ? page.health.contradictions + page.health.duplicates : 0;
  if (!findings) return html``;
  return html`<span class="side-alarm" title="${findings} ${findings === 1 ? "finding" : "findings"} at the last check">${icon(WARNING_PATH, 12)}${findings}</span>`;
}

/** A link shows only to whoever can use it: a link leading to an empty screen is worse than none. */
export function projectPage(page: ProjectPage, active: Section, body: Html): Html {
  const { project, manager, reviewer, pendingReviews, ancestors, children } = page;
  const base = `/p/${project.slug}`;
  const count = "entryCount" in project ? project.entryCount : null;

  const item = (s: SectionLink, aside: Html = html``) =>
    html`<a class="side-item ${s.id === active ? "on" : ""}" href="${base}${s.suffix}" ${s.id === active ? html`aria-current="page"` : ""}>${icon(s.icon)}<span>${s.label}</span>${aside}</a>`;

  const check = [
    item(link("memory", ""), count !== null ? html`<span class="side-count">${count}</span>` : html``),
    reviewer ? item(link("review", "/review"), pendingReviews ? html`<span class="side-attn">${pendingReviews}</span>` : html``) : html``,
    item(link("health", "/health"), healthMark(page)),
    children.length ? item(link("across", "/across")) : html``,
  ];
  const explore = [link("ask", "/ask"), link("agents", "/agents"), link("map", "/map"), link("code", "/code")].map((s) => item(s));

  return html`<div class="project-shell">
    <aside class="project-side" aria-label="${project.name}">
      ${crumbs(ancestors)}
      <p class="project-name">${project.name}</p>
      <p class="project-meta">
        ${count !== null ? html`${count} ${count === 1 ? "entry" : "entries"}` : ""}
        ${project.visibility === "private" ? visibilityPill("private") : ""}
      </p>
      <nav class="side-nav" aria-label="Sections of ${project.name}">
        <p class="side-label">Check</p>
        ${check}
        <p class="side-label">Explore</p>
        ${explore}
        ${manager ? html`<span class="side-sep"></span>${item(link("settings", "/settings"))}` : ""}
      </nav>
    </aside>
    <div class="project-main">
      <h1 class="section-title">${LABELS[active]}</h1>
      ${body}
    </div>
  </div>`;
}
