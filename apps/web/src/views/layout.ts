import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { getBrandLogoSvg, getBrandName } from "@cortex/shared";

/**
 * Fragmento HTML del render (hono/html): autoescapado por defecto en cada
 * interpolación. Los componentes/vistas devuelven este tipo y se componen sin
 * re-escapar (hono respeta `isEscaped`).
 */
export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Marca del header: logo del operador si lo hay (CORTEX_BRAND_LOGO_*), o un wordmark de
 *  texto. `raw()` solo se aplica al SVG de configuración, nunca a datos de usuario/BD. */
function brandMark(): Html {
  const name = getBrandName();
  const logo = getBrandLogoSvg();
  return logo
    ? html`<span class="logo">${raw(logo)}</span><span class="tag">${name}</span>`
    : html`<span class="wordmark">${name}</span>`;
}

/** Documento completo: <head> (estilos en /styles.css estático) + header de marca + main. */
export function layout(title: string, body: Html, user?: { email: string; admin: boolean } | null): Html {
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · ${getBrandName()}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header>
    <span class="brand">${brandMark()}</span>
    <nav>
      <a href="/">Inicio</a>
      <a href="/projects">Proyectos</a>
      <a href="/ask">Preguntar</a>
      <a href="/graph">Grafo</a>
      <a href="/code">Código</a>
      <a href="/lint">Lint</a>
      <a href="/usage">Coste IA</a>
      <a href="/?capture=1">Capturar</a>
      ${user ? html`<span style="margin-left:12px;color:var(--color-text-muted)">${user.email}${user.admin ? html` <span class="pill" style="padding:1px 6px">admin</span>` : ""}</span> <a href="/logout">Salir</a>` : ""}
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}
