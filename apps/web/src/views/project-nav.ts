import { html } from "hono/html";
import type { ProjectRef } from "@cortex/core";
import type { ProjectPage } from "../middleware/access.js";
import type { Html } from "./layout.js";

/**
 * The labels are written for whoever reads them, not for the system's insides: **Health**
 * rather than "Lint", **What agents see** rather than "Context pack". Someone opening the web
 * wants to know whether their memory is healthy and what their agent is being told; "lint" and
 * "pack" are what we call it (ADR-0050).
 */
export type Section = "memory" | "ask" | "agents" | "health" | "across" | "map" | "code" | "settings";

const SECTIONS: { id: Section; label: string; suffix: string }[] = [
  { id: "memory", label: "Memory", suffix: "" },
  { id: "ask", label: "Ask", suffix: "/ask" },
  { id: "agents", label: "What agents see", suffix: "/agents" },
  { id: "health", label: "Health", suffix: "/health" },
  { id: "map", label: "Map", suffix: "/map" },
  { id: "code", label: "Code", suffix: "/code" },
];

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
function crumbs(ancestors: ProjectRef[], current: string): Html {
  if (ancestors.length === 0) return html``;
  return html`<nav class="crumbs" aria-label="Breadcrumb">
    ${ancestors.map(
      (a) => html`${a.slug ? html`<a href="/p/${a.slug}">${a.name}</a>` : html`<span>${a.name}</span>`}<span class="sep">›</span>`,
    )}<span class="here">${current}</span>
  </nav>`;
}

/**
 * It takes what the guard already resolved (`requireProjectPage`) rather than five loose
 * arguments: who is looking, what it hangs off and what hangs off it are what decide which tabs
 * exist. `Settings` only shows for whoever manages it, and `Across this client` only when there
 * are children to look at -- a tab leading to an empty screen is worse than no tab.
 */
export function projectHeader(page: ProjectPage, active: Section): Html {
  const { project, manager, ancestors, children } = page;
  const base = `/p/${project.slug}`;
  const tabs = [...SECTIONS];
  // It goes right after Health, not at the end: it is the same question -- can I trust this? --
  // but looking at the whole client, and reading them together is how it makes sense. Map and
  // Code are something else, and Settings always closes.
  if (children.length) {
    tabs.splice(tabs.findIndex((t) => t.id === "health") + 1, 0, {
      id: "across",
      label: "Across this client",
      suffix: "/across",
    });
  }
  if (manager) tabs.push({ id: "settings", label: "Settings", suffix: "/settings" });
  const count = "entryCount" in project ? project.entryCount : null;
  return html`
    <div class="project-head">
      ${crumbs(ancestors, project.name)}
      <div class="project-title">
        <h1>${project.name}</h1>
        ${visibilityPill(project.visibility)}
        ${count !== null ? html`<span class="sub">${count} ${count === 1 ? "entry" : "entries"}</span>` : ""}
      </div>
      <nav class="tabs">
        ${tabs.map((t) => html`<a class="${t.id === active ? "on" : ""}" href="${base}${t.suffix}">${t.label}</a>`)}
      </nav>
    </div>`;
}
