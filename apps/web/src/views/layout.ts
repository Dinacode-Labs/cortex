import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * Fragmento HTML del render (hono/html): autoescapado por defecto en cada
 * interpolación. Los componentes/vistas devuelven este tipo y se componen sin
 * re-escapar (hono respeta `isEscaped`).
 */
export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

// Logo de marca Dinacode (wordmark). Primer glifo en azul, resto en tinta de marca.
// raw(): SVG estático escrito en este mismo fichero — no contiene datos de usuario/BD.
const DINACODE_LOGO = raw(`<svg viewBox="0 0 691.7 90.7" height="22" role="img" aria-label="Dinacode" style="display:block">
<path fill="#0099FF" d="M8.1,25.9c-0.6-1.1,0.2-2.4,1.4-2.4H18c0.6,0,1.1,0.3,1.4,0.8L28.9,41c0.8,1.4,1.2,3,1.2,4.6s-0.4,3.2-1.2,4.6l-9.5,16.7c-0.3,0.5-0.8,0.8-1.4,0.8H9.5c-1.2,0-2-1.3-1.4-2.4l9.4-16.5c0.6-1,0.8-2.1,0.8-3.2c0-1.1-0.3-2.2-0.8-3.2L8.1,25.9z"/>
<path fill="var(--brand-ink)" d="M111.1,3.6h12.1c0.9,0,1.6,0.7,1.6,1.6v80.4c0,0.9-0.7,1.6-1.6,1.6h-12.1c-0.9,0-1.6-0.7-1.6-1.6V5.2C109.5,4.3,110.2,3.6,111.1,3.6z"/>
<path fill="var(--brand-ink)" d="M223.2,5.2v80.4c0,0.9-0.7,1.6-1.6,1.6h-10.2c-0.5,0-0.9-0.2-1.2-0.6L168,34.1c-0.9-1.2-2.8-0.5-2.8,1v50.4c0,0.9-0.7,1.6-1.6,1.6h-12c-0.9,0-1.6-0.7-1.6-1.6V5.2c0-0.9,0.7-1.6,1.6-1.6h10.2c0.5,0,0.9,0.2,1.2,0.6l42.1,52.5c0.9,1.2,2.8,0.5,2.8-1V5.2c0-0.9,0.7-1.6,1.6-1.6h12C222.5,3.6,223.2,4.3,223.2,5.2z"/>
<path fill="var(--brand-ink)" d="M353.8,82.8c-6.7-3.7-12-8.8-15.8-15.3c-3.8-6.5-5.7-13.9-5.7-22.1c0-8.2,1.9-15.6,5.8-22.1c3.8-6.5,9.1-11.6,15.8-15.3c6.7-3.7,14.2-5.6,22.5-5.6c6.7,0,12.9,1.2,18.5,3.6c5.1,2.2,9.4,5.2,13.1,9.2c0.6,0.7,0.6,1.7-0.1,2.3l-7.6,7.3c-0.6,0.6-1.6,0.6-2.2,0c-5.8-5.8-12.7-8.7-20.9-8.7c-5.7,0-10.7,1.3-15.2,3.8c-4.5,2.5-8,6-10.5,10.4c-2.5,4.5-3.8,9.5-3.8,15.2c0,5.7,1.3,10.7,3.8,15.2c2.5,4.5,6,7.9,10.5,10.4c4.5,2.5,9.5,3.8,15.2,3.8c8.2,0,15.2-2.9,20.9-8.8c0.6-0.6,1.6-0.6,2.2,0l7.6,7.4c0.6,0.6,0.7,1.6,0.1,2.3c-3.6,4-8,7-13.1,9.2c-5.6,2.4-11.8,3.6-18.5,3.6C368,88.3,360.5,86.5,353.8,82.8z"/>
<path fill="var(--brand-ink)" d="M440.7,82.8c-6.8-3.7-12-8.8-15.9-15.4c-3.8-6.6-5.8-13.9-5.8-22s1.9-15.5,5.8-22c3.8-6.6,9.1-11.7,15.9-15.4c6.7-3.7,14.3-5.6,22.7-5.6c8.4,0,16,1.9,22.7,5.6c6.7,3.7,12,8.8,15.9,15.3c3.8,6.5,5.8,13.9,5.8,22.1c0,8.2-1.9,15.6-5.8,22.1c-3.8,6.5-9.1,11.6-15.9,15.3c-6.8,3.7-14.3,5.6-22.7,5.6C455,88.3,447.5,86.5,440.7,82.8z M478.3,71c4.4-2.5,7.8-6,10.4-10.5c2.5-4.5,3.8-9.5,3.8-15.1c0-5.6-1.3-10.6-3.8-15.1c-2.5-4.5-6-8-10.4-10.5c-4.4-2.5-9.3-3.8-14.8-3.8c-5.5,0-10.4,1.3-14.8,3.8c-4.4,2.5-7.8,6-10.4,10.5c-2.5,4.5-3.8,9.5-3.8,15.1c0,5.6,1.3,10.6,3.8,15.1c2.5,4.5,6,8,10.4,10.5c4.4,2.5,9.3,3.8,14.8,3.8C468.9,74.7,473.9,73.5,478.3,71z"/>
<path fill="var(--brand-ink)" d="M682.2,74c0,0-19.8,0-47,0c-0.9,0-1.6-0.7-1.6-1.6V52.7c0-0.9,0.7-1.6,1.6-1.6h36.6c0.9,0,1.6-0.7,1.6-1.6v-9.5c0-0.9-0.7-1.6-1.6-1.6h-36.6c-0.9,0-1.6-0.7-1.6-1.6V18.3c0-0.9,0.7-1.6,1.6-1.6c27.1,0,47,0,47,0c1.2,0,2-1.4,1.4-2.4l-3.5-6.1c-1.6-2.8-4.6-4.6-7.8-4.6l-52.4,0c-0.9,0-1.6,0.7-1.6,1.6v80.4c0,0.9,0.7,1.6,1.6,1.6h52.7l0,0c3.1-0.1,6-1.8,7.5-4.6l3.5-6.1C684.2,75.4,683.4,74,682.2,74z"/>
<path fill="var(--brand-ink)" d="M325.2,85.4l-36-80.9c-0.3-0.6-0.8-1-1.5-1h-13.1c-0.6,0-1.2,0.4-1.5,1l-35.9,80.9c-0.5,1.1,0.3,2.3,1.5,2.3h12.4c0.6,0,1.2-0.4,1.5-1l27-64.1c0.6-1.3,2.4-1.3,2.9,0L296.7,56h-10.7c-5.9,0-11.1,3.5-13.5,9l-0.4,1c-0.5,1.1,0.3,2.3,1.5,2.3h28.2l7.9,18.5c0.3,0.6,0.8,1,1.5,1h12.6C324.9,87.7,325.7,86.5,325.2,85.4z"/>
<path fill="var(--brand-ink)" d="M84.6,23.4c-3.8-6.3-9.1-11.2-15.9-14.7c-6.8-3.5-14.6-5.2-23.4-5.2H20.6c-1.3,0-2,1.4-1.3,2.5l4.6,7c1.5,2.2,4,3.6,6.6,3.6h14.1c6,0,11.4,1.2,15.9,3.5c4.6,2.3,8.1,5.7,10.6,10c2.5,4.3,3.7,9.4,3.7,15.1c0,5.7-1.2,10.8-3.7,15.1c-2.5,4.3-6,7.7-10.6,10C56,72.8,50.7,74,44.6,74H30.6c-2.7,0-5.1,1.3-6.6,3.6l-4.6,7c-0.7,1.1,0,2.5,1.3,2.5h24.7c8.8,0,16.6-1.7,23.4-5.2c6.8-3.5,12.1-8.4,15.9-14.7c3.8-6.3,5.7-13.6,5.7-21.9C90.3,37.1,88.4,29.8,84.6,23.4z"/>
<path fill="var(--brand-ink)" d="M519.3,5.2c0-0.9,0.7-1.6,1.6-1.6h32.7c8.8,0,16.6,1.7,23.4,5.2c6.8,3.5,12.1,8.4,15.9,14.7c3.8,6.3,5.7,13.6,5.7,21.9c0,8.3-1.9,15.6-5.7,21.9c-3.8,6.3-9.1,11.2-15.9,14.7c-6.8,3.5-14.6,5.2-23.4,5.2h-32.7c-0.9,0-1.6-0.7-1.6-1.6V5.2z M552.9,74c6,0,11.4-1.2,15.9-3.5c4.6-2.3,8.1-5.7,10.6-10c2.5-4.3,3.7-9.4,3.7-15.1c0-5.7-1.2-10.8-3.7-15.1c-2.5-4.3-6-7.7-10.6-10c-4.6-2.3-9.9-3.5-15.9-3.5h-16.7c-0.9,0-1.6,0.7-1.6,1.6v54.1c0,0.9,0.7,1.6,1.6,1.6H552.9z"/>
</svg>`);

/** Documento completo: <head> (estilos en /styles.css estático) + header de marca + main. */
export function layout(title: string, body: Html, user?: { email: string; admin: boolean } | null): Html {
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Dinacode Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header>
    <span class="brand"><span class="logo">${DINACODE_LOGO}</span><span class="tag">Cortex</span></span>
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
