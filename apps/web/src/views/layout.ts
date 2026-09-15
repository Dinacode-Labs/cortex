import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { getBrandLogoSvg, getBrandName } from "@cortex/shared";

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

/** Marca del header: logo del operador si lo hay (CORTEX_BRAND_LOGO_*), o un wordmark de
 *  texto. `raw()` solo se aplica al SVG de configuración, nunca a datos de usuario/BD. */
function brandMark(): Html {
  const name = getBrandName();
  const logo = getBrandLogoSvg();
  return logo
    ? html`<span class="logo">${raw(logo)}</span><span class="tag">${name}</span>`
    : html`<span class="wordmark">${name}</span>`;
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
 * cruza proyectos— y por dónde se sale. Antes tenía ocho enlaces planos (Home, Projects, Ask,
 * Graph, Code, Lint, AI cost, Capture), ninguno de los cuales se llevaba consigo el proyecto
 * que estabas mirando: ir de una sección a otra te devolvía al primero de la lista. Las
 * secciones ahora cuelgan del proyecto, que es la unidad de todo (ADR-0050).
 */
export function layout(title: string, body: Html, opts: OpcionesLayout | Usuario | null = {}): Html {
  // Compatibilidad con las llamadas `layout(t, b, user)` que quedan por el código.
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
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
            <span class="whoami">${user.email}${user.admin ? html` <span class="pill tiny">admin</span>` : ""}</span>
            <a href="/logout">Sign out</a>`
        : ""}
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}
