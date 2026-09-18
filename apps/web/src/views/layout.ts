import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { getBrandLogoSvg, getBrandName } from "@cortex/shared";
import { ASSET_VERSION } from "../version.js";

/**
 * An HTML fragment of the render (hono/html): auto-escaped by default at every interpolation.
 * Components and views return this type and compose without re-escaping (hono honours
 * `isEscaped`).
 */
export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export interface User {
  email: string;
  admin: boolean;
}

/**
 * The default mark: three connected nodes, which is literally what is inside.
 *
 * The brand used to be the word "Cortex" with the first letter in blue, a CSS trick that read
 * as what it was: not having decided. An operator can set their own with
 * `CORTEX_BRAND_LOGO_SVG`; this is what you get when you set nothing.
 */
const BRAND_SVG = `<svg class="mark" viewBox="0 0 28 28" fill="none" aria-hidden="true">
  <rect width="28" height="28" rx="7" fill="#1a6dff"/>
  <path d="M9 9.5 19 14M9 18.5 19 14M9 9.5v9" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="9" cy="9.5" r="2.6" fill="#fff"/><circle cx="9" cy="18.5" r="2.6" fill="#fff"/>
  <circle cx="19" cy="14" r="3" fill="#fff"/>
</svg>`;

/** `raw()` only over SVG from configuration or from this file, never over data. */
function brandMark(): Html {
  const name = getBrandName();
  const logo = getBrandLogoSvg();
  return logo
    ? html`<span class="logo">${raw(logo)}</span><span class="tag">${name}</span>`
    : html`${raw(BRAND_SVG)}<span class="wordmark">${name}</span>`;
}

export interface LayoutOptions {
  user?: User | null;
  /** Which header link is marked as current. */
  active?: "projects" | "admin";
  /** The text in the global search box, so it is not lost when the results appear. */
  q?: string;
}

/**
 * The whole document.
 *
 * The header carries **only what is genuinely global**: the brand, the search -- the one thing
 * that crosses projects -- and the way out. The sections hang off the project (ADR-0050).
 *
 * The stylesheet carries the version pinned to it. Without that, a deploy that changes the CSS
 * leaves anyone who had visited before with the old copy in their browser cache -- with neither
 * `Cache-Control` nor `ETag`, only `Last-Modified`, the browser keeps it without asking -- and
 * the interface shows up half painted. It happened, and from outside it looks as though the
 * redesign was never deployed.
 */
export function layout(title: string, body: Html, opts: LayoutOptions | User | null = {}): Html {
  const o: LayoutOptions = opts && "email" in opts ? { user: opts } : ((opts ?? {}) as LayoutOptions);
  const user = o.user;
  const brand = getBrandName();
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · ${brand}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css?v=${ASSET_VERSION}">
</head>
<body>
  <header>
    <a class="brand" href="/">${brandMark()}</a>
    ${user
      ? html`<form class="global-search" method="get" action="/search">
          <input type="search" name="q" value="${o.q ?? ""}" placeholder="Search everything…" aria-label="Search ${brand}">
        </form>`
      : ""}
    <nav>
      ${user
        ? html`<a class="${o.active === "projects" ? "on" : ""}" href="/">Projects</a>
            ${user.admin ? html`<a class="${o.active === "admin" ? "on" : ""}" href="/admin/usage">Admin</a>` : ""}
            <span class="whoami">
              <span class="email">${user.email}</span>${user.admin ? html`<span class="pill tiny">admin</span>` : ""}
            </span>
            <a href="/logout">Sign out</a>`
        : ""}
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}
