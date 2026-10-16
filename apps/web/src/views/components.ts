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

const STATE_ICONS: Partial<Record<Tone, string>> = {
  danger: '<path d="M8 2 14.5 13.5h-13Z"/><path d="M8 6.5v3M8 11.5v.1"/>',
  warn: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11v.1"/>',
  ok: '<path d="m3 8.5 3 3 7-7"/>',
};

/** Never colour alone: a word, and an icon. `raw()` only over the drawings above. */
export function stateMark(tone: Tone, label: string): Html {
  const paths = STATE_ICONS[tone];
  const drawing = paths
    ? raw(`<svg class="state-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`)
    : "";
  return html`<span class="state state-${tone}">${drawing}${label}</span>`;
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
  id?: string;
}

export function panel(title: string | null, body: Html, opts: PanelOptions = {}): Html {
  return html`<section class="panel" ${opts.id ? html`id="${opts.id}"` : ""}>
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

export interface ProjectRow {
  project: AccessibleProject;
  depth: number;
  children: number;
}

/**
 * It lives here rather than on the home page because a client lists its repos with it too: were
 * they two different lists, picking "Acme Portal" from the home page and picking it from "Acme"
 * would look like two different things, and they are the same.
 */
export function projectTable(rows: ProjectRow[], healthOf: Map<string, Html>, waiting: Map<string, number>): Html {
  return html`<div class="project-table">
    <div class="project-row project-head" aria-hidden="true">
      <span>Project</span><span>Entries</span><span>To review</span><span>Last health check</span><span>Owner</span>
    </div>
    ${rows.map(({ project: p, depth, children }) => {
      const queued = waiting.get(p.id);
      return html`<a class="project-row" href="/p/${p.slug}" style="--depth:${depth}">
        <span class="project-cell">${depth ? html`<span class="tree" aria-hidden="true"></span>` : ""}<b>${p.name}</b>
          ${children ? html`<span class="badge tone-neutral">client · ${children} ${children === 1 ? "project" : "projects"}</span>` : ""}
          ${p.visibility === "private" ? visibilityPill("private") : ""}</span>
        <span class="project-num">${p.entryCount}</span>
        <span>${queued ? html`<span class="side-attn" title="Memos waiting for a verdict">${queued}</span>` : html`<span class="faint">—</span>`}</span>
        <span>${healthOf.get(p.id) ?? ""}</span>
        <span class="owner">${p.ownerEmail ?? html`<span class="unclaimed">unclaimed</span>`}</span>
      </a>`;
    })}
  </div>`;
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
