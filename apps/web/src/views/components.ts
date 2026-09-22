import { html, raw } from "hono/html";
import type { AccessibleProject } from "@cortex/core";
import type { ContextEntry } from "@cortex/shared";
import { visibilityPill } from "./project-nav.js";
import type { Html } from "./layout.js";

/**
 * The interface's building blocks.
 *
 * Everything that repeats across more than one screen lives here, and the routes COMPOSE
 * instead of writing loose HTML. When every page drew itself, the same idea -- a card, a panel,
 * a warning -- came out differently in each place and the whole looked like the work of four
 * people who never spoke to each other. A component is also the one place to fix something
 * once (ADR-0053).
 */

/** Joins already-escaped fragments without escaping them again. */
export function joinHtml(parts: Html[], sep = ""): Html {
  return html`${parts.flatMap((p, i) => (i === 0 ? [p] : [raw(sep), p]))}`;
}

// The interface's colour is almost all ink on paper; what colour there is carries meaning.
// These maps are that meaning, which is why they live together: when a state changes colour it
// changes here and everywhere at once.

const STATUS_COLORS: Record<string, string> = {
  pending_validation: "#9a5b00",
  validated: "#0f7b3d",
  rejected: "#b3261e",
  superseded: "#5b6673",
  obsolete: "#5b6673",
  draft: "#5b6673",
  active: "#0f7b3d",
  archived: "#5b6673",
};

const TYPE_COLORS: Record<string, string> = {
  decision: "#1a6dff",
  constraint: "#9a5b00",
  incident: "#b3261e",
  risk: "#b3261e",
  technical_debt: "#8a4b00",
  convention: "#0f7b3d",
  architecture: "#6b3fa0",
};

export function badge(text: string, color: string): Html {
  return html`<span class="badge" style="color:${color};background:${color}14">${text}</span>`;
}

export const statusBadge = (s: string): Html => badge(s, STATUS_COLORS[s] ?? "#5b6673");
export const typeBadge = (t: string): Html => badge(t, TYPE_COLORS[t] ?? "#5b6673");
export const confidenceBadge = (c: string): Html => badge(`conf: ${c}`, "#5b6673");
export const scoreBadge = (n: number): Html => badge(n.toFixed(2), "#1a6dff");

export interface PanelOptions {
  help?: Html | string;
  actions?: Html;
}

export function panel(title: string | null, body: Html, opts: PanelOptions = {}): Html {
  return html`<section class="panel">
    ${title
      ? html`<div class="row-between" style="margin-bottom:8px">
          <h2>${title}</h2>${opts.actions ?? ""}
        </div>`
      : ""}
    ${opts.help ? html`<p class="sub" style="margin-bottom:16px">${opts.help}</p>` : ""}
    ${body}
  </section>`;
}

/**
 * An empty state that says what to do.
 *
 * "There is nothing here" is useless information: whoever reads it can already see that. What
 * they need to know is whether that is fine, and what to do if it is not.
 */
export function empty(message: Html | string, actions?: Html): Html {
  return html`<div class="empty">
    <p>${message}</p>
    ${actions ? html`<div class="row" style="justify-content:center;margin-top:16px">${actions}</div>` : ""}
  </div>`;
}

export function warn(message: Html | string, kind: "notice" | "contradiction" = "notice"): Html {
  return html`<div class="warn ${kind === "contradiction" ? "contradiction" : ""}">${message}</div>`;
}

export function entryCard(entry: ContextEntry): Html {
  return html`<a class="card" href="/entry/${entry.id}">
    <div class="card-head">${typeBadge(entry.type)} ${statusBadge(entry.status)} ${confidenceBadge(entry.confidence)}</div>
    <h3>${entry.title}</h3>
    <p>${entry.summary ?? entry.content}</p>
    ${entry.sourceReference ? html`<div class="src">${entry.sourceReference}</div>` : ""}
  </a>`;
}

/**
 * A search result: the same card with the score in front, so there are not two cards.
 * `origin` is filled in by whoever searches across more than one project at a time -- without
 * it, results from three different repos read as if they came from the same one.
 */
export function hitCard(entry: ContextEntry, score: number, origin?: Html): Html {
  return html`<a class="card" href="/entry/${entry.id}">
    <div class="card-head">${scoreBadge(score)} ${typeBadge(entry.type)} ${statusBadge(entry.status)} ${origin ?? ""}</div>
    <h3>${entry.title}</h3>
    <p>${entry.summary ?? entry.content}</p>
  </a>`;
}

/**
 * The card a project is chosen from.
 *
 * It lives here rather than on the home page because a client shows it inside itself too, for
 * its repos: were they two different cards, picking "Acme Portal" from the home page and
 * picking it from "Acme" would look like two different things, and they are the same.
 */
export function projectCard(p: AccessibleProject, health: Html): Html {
  return html`<a class="project-card" href="/p/${p.slug}">
    <div class="card-head">
      <h2>${p.name}</h2>
      ${visibilityPill(p.visibility)}
    </div>
    <div class="owner">${p.ownerEmail ?? html`<span class="unclaimed">unclaimed</span>`}</div>
    <div class="card-foot">
      <span>${p.entryCount} ${p.entryCount === 1 ? "entry" : "entries"}</span>
      ${health}
    </div>
  </a>`;
}

/**
 * A search box with its button: it appears in five places and must be the same in all five.
 * `extra` is for whatever only makes sense in one of them -- today, the checkbox that reaches
 * down into the children from a client -- and it sits between the field and the button so it
 * gets read before anyone presses.
 */
export function searchForm(
  action: string,
  q: string,
  placeholder: string,
  hidden: Record<string, string> = {},
  extra?: Html,
): Html {
  return html`<form class="row" method="get" action="${action}">
    ${Object.entries(hidden).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <input type="text" name="q" value="${q}" placeholder="${placeholder}" required>
    ${extra ?? ""}
    <button type="submit">Search</button>
  </form>`;
}
