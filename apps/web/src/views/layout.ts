import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { getBrandLogoSvg, getBrandName, markSvg } from "@cortex/shared";
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
 * The default mark, "Relay": two pieces that change places and a centre that stays. The drawing
 * lives in `@cortex/shared` (`MARK_GRID`), which is also where the favicon and the CLI splash come
 * from. Here the pieces are hollow — paper fill and a hairline grey stroke — and the centre takes
 * the accent; the colours are `styles.css` variables, and so is the animation, hooked on
 * `mark-relay`, which an operator's logo never carries. An operator can set their own with
 * `CORTEX_BRAND_LOGO_SVG`; this is what you get when you set nothing.
 */
function defaultMarkSvg(play: boolean): string {
  return markSvg({
    ink: "var(--muted)",
    accent: "var(--accent)",
    hollow: { fill: "var(--surface)", strokeWidth: 0.3 },
    className: play ? "mark mark-relay play" : "mark mark-relay",
  });
}

/** `raw()` only over SVG from configuration or from this file, never over data. */
function brandMark(play: boolean): Html {
  const name = getBrandName();
  const logo = getBrandLogoSvg();
  return logo
    ? html`<span class="logo">${raw(logo)}</span><span class="tag">${name}</span>`
    : html`${raw(defaultMarkSvg(play))}<span class="wordmark">${name}</span>`;
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
  // The mark only animates on arrival (sign-in) and on the home page: on every page it would be noise.
  const play = !user || o.active === "projects";
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · ${brand}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="icon" href="/favicon.svg?v=${ASSET_VERSION}" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css?v=${ASSET_VERSION}">
</head>
<body>
  <header>
    <a class="brand" href="/">${brandMark(play)}</a>
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
