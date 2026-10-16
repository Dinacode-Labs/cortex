import { html, raw } from "hono/html";
import type { AccessibleProject } from "@cortex/core";
import { visibilityPill } from "./project-nav.js";
import type { Html } from "./layout.js";
import { ASSET_VERSION } from "../version.js";
import type { Memo } from "@cortex/core";

/**
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

export type Tone = "accent" | "ok" | "warn" | "danger" | "neutral";

const STATUS_TONES: Record<string, Tone> = {
  pending_validation: "warn",
  validated: "ok",
  rejected: "danger",
  superseded: "neutral",
  obsolete: "neutral",
  draft: "neutral",
  active: "ok",
  archived: "neutral",
};

const TYPES_WITH_A_COLOUR = new Set(["decision", "constraint", "incident", "risk", "technical_debt", "convention", "architecture"]);

export function badge(text: string, tone: Tone = "neutral"): Html {
  return html`<span class="badge tone-${tone}">${text}</span>`;
}

const STATUS_LABELS: Record<string, string> = { pending_validation: "pending" };
export const statusLabel = (s: string): string => STATUS_LABELS[s] ?? s;

export const statusBadge = (s: string): Html => badge(statusLabel(s), STATUS_TONES[s]);
export const typeBadge = (t: string): Html =>
  TYPES_WITH_A_COLOUR.has(t) ? html`<span class="badge type-${t}">${t}</span>` : badge(t);
export const confidenceBadge = (c: string): Html => badge(`conf: ${c}`);
export const scoreBadge = (n: number): Html => badge(n.toFixed(2), "accent");

export const typeTag = (t: string): Html =>
  html`<span class="type-tag ${TYPES_WITH_A_COLOUR.has(t) ? `type-${t}` : ""}">${t}</span>`;

export function confidenceMeter(c: string): Html {
  return html`<span class="confidence conf-${c}" title="Confidence: ${c}"><i></i><i></i><i></i><i></i><span>${c}</span></span>`;
}

export interface Choice {
  label: Html | string;
  href: string;
  on: boolean;
  count?: number;
}

const choiceCount = (c: Choice, cls: string): Html => (c.count === undefined ? html`` : html`<span class="${cls}">${c.count}</span>`);

export function segmented(label: string, choices: Choice[]): Html {
  return html`<nav class="segmented" aria-label="${label}">${choices.map(
    (c) => html`<a class="${c.on ? "on" : ""} ${c.count === 0 ? "zero" : ""}" href="${c.href}" ${c.on ? html`aria-current="true"` : ""}>${c.label}${choiceCount(c, "segment-count")}</a>`,
  )}</nav>`;
}

/** `<details>` and links, so it works with no script (ADR-0042). */
export function menu(label: string, current: Html | string, choices: Choice[]): Html {
  return html`<details class="menu">
    <summary><span class="menu-label">${label}</span> ${current}</summary>
    <div class="menu-list">${choices.map(
      (c) => html`<a class="${c.on ? "on" : ""}" href="${c.href}">${c.label}${choiceCount(c, "menu-count")}</a>`,
    )}</div>
  </details>`;
}

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

export interface EntrySelectionOptions {
  action: string;
  hidden: Record<string, string>;
  allChecked: boolean;
  toggleHref: string;
  /** Whether a type or status filter is on, which is what "everything" then means. */
  filtered: boolean;
}

export function entrySelection(list: Html, opts: EntrySelectionOptions): Html {
  return html`<form method="post" action="${opts.action}" data-bulk-select>
      ${Object.entries(opts.hidden).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
      <div class="select-bar">
        <a class="button quiet" href="${opts.toggleHref}" data-select-toggle>${opts.allChecked ? "Clear selection" : "Select all visible"}</a>
        <span class="sub" data-selected-count hidden></span>
        <button class="danger" type="submit" data-purge-selected>Purge selected…</button>
        <button class="quiet" type="submit" name="scope" value="all">${opts.filtered ? "Purge everything matching these filters…" : "Purge the whole project…"}</button>
      </div>
      ${list}
    </form>
    <script src="/select.js?v=${ASSET_VERSION}" defer></script>`;
}

/**
 * A search result: the same card with the score in front, so there are not two cards.
 * `origin` is filled in by whoever searches across more than one project at a time -- without
 * it, results from three different repos read as if they came from the same one.
 */
export function hitCard(entry: Memo, score: number, origin?: Html): Html {
  return html`<a class="card" href="/entry/${entry.id}">
    <div class="card-head">${scoreBadge(score)} ${typeBadge(entry.type)} ${statusBadge(entry.status)} ${origin ?? ""}</div>
    <h3>${entry.title}</h3>
    <p>${entry.summary ?? entry.content}</p>
  </a>`;
}

/**
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
