import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { getBrandLogoSvg, getBrandName } from "@cortex/shared";
import { ASSET_VERSION } from "../version.js";

/**
 * Fragmento HTML del render (hono/html): autoescapado por defecto en cada
 * interpolación. Los componentes/vistas devuelven este tipo y se componen sin
 * re-escapar (hono respeta `isEscaped`).
 */
export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export interface Usuario {
  email: string;
  admin: boolean;
}

/**
 * El sello por defecto: tres nodos unidos, que es literalmente lo que hay dentro.
 *
 * Antes la marca era la palabra «Cortex» con la primera letra en azul, un truco de CSS que se
 * lee como lo que era: no haber decidido. Un operador puede poner el suyo con
 * `CORTEX_BRAND_LOGO_SVG`; esto es lo que ve quien no pone nada.
 */
const MARCA_SVG = `<svg class="mark" viewBox="0 0 28 28" fill="none" aria-hidden="true">
  <rect width="28" height="28" rx="7" fill="#1a6dff"/>
  <path d="M9 9.5 19 14M9 18.5 19 14M9 9.5v9" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="9" cy="9.5" r="2.6" fill="#fff"/><circle cx="9" cy="18.5" r="2.6" fill="#fff"/>
  <circle cx="19" cy="14" r="3" fill="#fff"/>
</svg>`;

/** `raw()` solo sobre SVG de configuración o de este fichero, nunca sobre datos. */
function brandMark(): Html {
  const name = getBrandName();
  const logo = getBrandLogoSvg();
  return logo
    ? html`<span class="logo">${raw(logo)}</span><span class="tag">${name}</span>`
    : html`${raw(MARCA_SVG)}<span class="wordmark">${name}</span>`;
}

export interface OpcionesLayout {
  user?: Usuario | null;
  /** Qué enlace del header va marcado como actual. */
  activo?: "projects" | "admin";
  /** Texto en la caja de búsqueda global, para que no se pierda al ver los resultados. */
  q?: string;
}

/**
 * Documento completo.
 *
 * El header lleva **solo lo que es de verdad global**: la marca, la búsqueda —lo único que
 * cruza proyectos— y por dónde se sale. Las secciones cuelgan del proyecto (ADR-0050).
 *
 * La hoja de estilos va con la versión pegada. Sin eso, un despliegue que cambia el CSS deja a
 * quien ya había entrado con la copia vieja en la caché del navegador —sin `Cache-Control` ni
 * `ETag`, solo `Last-Modified`, el navegador se la queda sin preguntar— y la interfaz aparece
 * a medio pintar. Pasó, y desde fuera parece que el rediseño no se ha desplegado.
 */
export function layout(title: string, body: Html, opts: OpcionesLayout | Usuario | null = {}): Html {
  const o: OpcionesLayout = opts && "email" in opts ? { user: opts } : ((opts ?? {}) as OpcionesLayout);
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
        ? html`<a class="${o.activo === "projects" ? "on" : ""}" href="/">Projects</a>
            ${user.admin ? html`<a class="${o.activo === "admin" ? "on" : ""}" href="/admin/usage">Admin</a>` : ""}
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
