import type { ContextEntry } from "@cortex/shared";

/** Escapa HTML para evitar inyección al renderizar contenido. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Markdown ligero y seguro: escapa todo primero y luego aplica negritas,
 * listas con viñetas y párrafos. Suficiente para la prosa del agente LLM.
 */
export function mdLite(text: string): string {
  const lines = esc(text).split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const bold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${bold(line.slice(2))}</li>`);
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      if (line) out.push(`<p>${bold(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

// Logo de marca Dinacode (wordmark). Primer glifo en azul, resto en tinta de marca.
const DINACODE_LOGO = `<svg viewBox="0 0 691.7 90.7" height="22" role="img" aria-label="Dinacode" style="display:block">
<path fill="#0099FF" d="M8.1,25.9c-0.6-1.1,0.2-2.4,1.4-2.4H18c0.6,0,1.1,0.3,1.4,0.8L28.9,41c0.8,1.4,1.2,3,1.2,4.6s-0.4,3.2-1.2,4.6l-9.5,16.7c-0.3,0.5-0.8,0.8-1.4,0.8H9.5c-1.2,0-2-1.3-1.4-2.4l9.4-16.5c0.6-1,0.8-2.1,0.8-3.2c0-1.1-0.3-2.2-0.8-3.2L8.1,25.9z"/>
<path fill="var(--brand-ink)" d="M111.1,3.6h12.1c0.9,0,1.6,0.7,1.6,1.6v80.4c0,0.9-0.7,1.6-1.6,1.6h-12.1c-0.9,0-1.6-0.7-1.6-1.6V5.2C109.5,4.3,110.2,3.6,111.1,3.6z"/>
<path fill="var(--brand-ink)" d="M223.2,5.2v80.4c0,0.9-0.7,1.6-1.6,1.6h-10.2c-0.5,0-0.9-0.2-1.2-0.6L168,34.1c-0.9-1.2-2.8-0.5-2.8,1v50.4c0,0.9-0.7,1.6-1.6,1.6h-12c-0.9,0-1.6-0.7-1.6-1.6V5.2c0-0.9,0.7-1.6,1.6-1.6h10.2c0.5,0,0.9,0.2,1.2,0.6l42.1,52.5c0.9,1.2,2.8,0.5,2.8-1V5.2c0-0.9,0.7-1.6,1.6-1.6h12C222.5,3.6,223.2,4.3,223.2,5.2z"/>
<path fill="var(--brand-ink)" d="M353.8,82.8c-6.7-3.7-12-8.8-15.8-15.3c-3.8-6.5-5.7-13.9-5.7-22.1c0-8.2,1.9-15.6,5.8-22.1c3.8-6.5,9.1-11.6,15.8-15.3c6.7-3.7,14.2-5.6,22.5-5.6c6.7,0,12.9,1.2,18.5,3.6c5.1,2.2,9.4,5.2,13.1,9.2c0.6,0.7,0.6,1.7-0.1,2.3l-7.6,7.3c-0.6,0.6-1.6,0.6-2.2,0c-5.8-5.8-12.7-8.7-20.9-8.7c-5.7,0-10.7,1.3-15.2,3.8c-4.5,2.5-8,6-10.5,10.4c-2.5,4.5-3.8,9.5-3.8,15.2c0,5.7,1.3,10.7,3.8,15.2c2.5,4.5,6,7.9,10.5,10.4c4.5,2.5,9.5,3.8,15.2,3.8c8.2,0,15.2-2.9,20.9-8.8c0.6-0.6,1.6-0.6,2.2,0l7.6,7.4c0.6,0.6,0.7,1.6,0.1,2.3c-3.6,4-8,7-13.1,9.2c-5.6,2.4-11.8,3.6-18.5,3.6C368,88.3,360.5,86.5,353.8,82.8z"/>
<path fill="var(--brand-ink)" d="M440.7,82.8c-6.8-3.7-12-8.8-15.9-15.4c-3.8-6.6-5.8-13.9-5.8-22s1.9-15.5,5.8-22c3.8-6.6,9.1-11.7,15.9-15.4c6.7-3.7,14.3-5.6,22.7-5.6c8.4,0,16,1.9,22.7,5.6c6.7,3.7,12,8.8,15.9,15.3c3.8,6.5,5.8,13.9,5.8,22.1c0,8.2-1.9,15.6-5.8,22.1c-3.8,6.5-9.1,11.6-15.9,15.3c-6.8,3.7-14.3,5.6-22.7,5.6C455,88.3,447.5,86.5,440.7,82.8z M478.3,71c4.4-2.5,7.8-6,10.4-10.5c2.5-4.5,3.8-9.5,3.8-15.1c0-5.6-1.3-10.6-3.8-15.1c-2.5-4.5-6-8-10.4-10.5c-4.4-2.5-9.3-3.8-14.8-3.8c-5.5,0-10.4,1.3-14.8,3.8c-4.4,2.5-7.8,6-10.4,10.5c-2.5,4.5-3.8,9.5-3.8,15.1c0,5.6,1.3,10.6,3.8,15.1c2.5,4.5,6,8,10.4,10.5c4.4,2.5,9.3,3.8,14.8,3.8C468.9,74.7,473.9,73.5,478.3,71z"/>
<path fill="var(--brand-ink)" d="M682.2,74c0,0-19.8,0-47,0c-0.9,0-1.6-0.7-1.6-1.6V52.7c0-0.9,0.7-1.6,1.6-1.6h36.6c0.9,0,1.6-0.7,1.6-1.6v-9.5c0-0.9-0.7-1.6-1.6-1.6h-36.6c-0.9,0-1.6-0.7-1.6-1.6V18.3c0-0.9,0.7-1.6,1.6-1.6c27.1,0,47,0,47,0c1.2,0,2-1.4,1.4-2.4l-3.5-6.1c-1.6-2.8-4.6-4.6-7.8-4.6l-52.4,0c-0.9,0-1.6,0.7-1.6,1.6v80.4c0,0.9,0.7,1.6,1.6,1.6h52.7l0,0c3.1-0.1,6-1.8,7.5-4.6l3.5-6.1C684.2,75.4,683.4,74,682.2,74z"/>
<path fill="var(--brand-ink)" d="M325.2,85.4l-36-80.9c-0.3-0.6-0.8-1-1.5-1h-13.1c-0.6,0-1.2,0.4-1.5,1l-35.9,80.9c-0.5,1.1,0.3,2.3,1.5,2.3h12.4c0.6,0,1.2-0.4,1.5-1l27-64.1c0.6-1.3,2.4-1.3,2.9,0L296.7,56h-10.7c-5.9,0-11.1,3.5-13.5,9l-0.4,1c-0.5,1.1,0.3,2.3,1.5,2.3h28.2l7.9,18.5c0.3,0.6,0.8,1,1.5,1h12.6C324.9,87.7,325.7,86.5,325.2,85.4z"/>
<path fill="var(--brand-ink)" d="M84.6,23.4c-3.8-6.3-9.1-11.2-15.9-14.7c-6.8-3.5-14.6-5.2-23.4-5.2H20.6c-1.3,0-2,1.4-1.3,2.5l4.6,7c1.5,2.2,4,3.6,6.6,3.6h14.1c6,0,11.4,1.2,15.9,3.5c4.6,2.3,8.1,5.7,10.6,10c2.5,4.3,3.7,9.4,3.7,15.1c0,5.7-1.2,10.8-3.7,15.1c-2.5,4.3-6,7.7-10.6,10C56,72.8,50.7,74,44.6,74H30.6c-2.7,0-5.1,1.3-6.6,3.6l-4.6,7c-0.7,1.1,0,2.5,1.3,2.5h24.7c8.8,0,16.6-1.7,23.4-5.2c6.8-3.5,12.1-8.4,15.9-14.7c3.8-6.3,5.7-13.6,5.7-21.9C90.3,37.1,88.4,29.8,84.6,23.4z"/>
<path fill="var(--brand-ink)" d="M519.3,5.2c0-0.9,0.7-1.6,1.6-1.6h32.7c8.8,0,16.6,1.7,23.4,5.2c6.8,3.5,12.1,8.4,15.9,14.7c3.8,6.3,5.7,13.6,5.7,21.9c0,8.3-1.9,15.6-5.7,21.9c-3.8,6.3-9.1,11.2-15.9,14.7c-6.8,3.5-14.6,5.2-23.4,5.2h-32.7c-0.9,0-1.6-0.7-1.6-1.6V5.2z M552.9,74c6,0,11.4-1.2,15.9-3.5c4.6-2.3,8.1-5.7,10.6-10c2.5-4.3,3.7-9.4,3.7-15.1c0-5.7-1.2-10.8-3.7-15.1c-2.5-4.3-6-7.7-10.6-10c-4.6-2.3-9.9-3.5-15.9-3.5h-16.7c-0.9,0-1.6,0.7-1.6,1.6v54.1c0,0.9,0.7,1.6,1.6,1.6H552.9z"/>
</svg>`;

const STATUS_COLORS: Record<string, string> = {
  validated: "#1a7f37",
  verified: "#1a7f37",
  pending_validation: "#9a6700",
  draft: "#0969da",
  rejected: "#cf222e",
  obsolete: "#6e7781",
  superseded: "#8250df",
  historical: "#6e7781",
};

const TYPE_COLORS: Record<string, string> = {
  decision: "#0099ff",
  constraint: "#9a6700",
  incident: "#cf222e",
  risk: "#bc4c00",
  technical_debt: "#6e4cff",
  architecture: "#1a7f37",
  convention: "#57606a",
};

export function badge(text: string, color: string): string {
  return `<span class="badge" style="background:${color}14;color:${color};border:1px solid ${color}44">${esc(text)}</span>`;
}

export function statusBadge(status: string): string {
  return badge(status, STATUS_COLORS[status] ?? "#57606a");
}

export function typeBadge(type: string): string {
  return badge(type, TYPE_COLORS[type] ?? "#57606a");
}

export function confidenceBadge(confidence: string): string {
  return badge(`conf: ${confidence}`, "#57606a");
}

export function entryCard(entry: ContextEntry): string {
  return `
    <a class="card" href="/entry/${esc(entry.id)}">
      <div class="card-head">
        ${typeBadge(entry.type)} ${statusBadge(entry.status)} ${confidenceBadge(entry.confidence)}
      </div>
      <h3>${esc(entry.title)}</h3>
      <p>${esc(entry.summary ?? entry.content)}</p>
      ${entry.sourceReference ? `<div class="src">fuente: ${esc(entry.sourceReference)}</div>` : ""}
    </a>`;
}

export function layout(title: string, body: string, user?: { email: string; admin: boolean } | null): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Dinacode Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    /* === Dinacode Design System — tokens === */
    :root {
      --color-primary:#0099ff; --color-primary-hover:#0077cc; --brand-ink:#01001c;
      --color-text:#111111; --color-text-muted:#666666; --color-muted:#999999;
      --color-background:#ffffff; --color-background-muted:#f9f9f9; --color-border:#e5e5e5;
      --primary-soft:color-mix(in srgb, var(--color-primary) 8%, var(--color-background));
      --primary-ring:color-mix(in srgb, var(--color-primary) 45%, transparent);
      --font-sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
      --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
      --radius-sm:6px; --radius-md:8px; --radius-lg:10px; --radius-xl:14px; --radius-2xl:18px; --radius-full:9999px;
      --shadow-sm:0 1px 3px rgba(0,0,0,.05); --shadow-md:0 8px 24px -8px rgba(0,0,0,.12);
      --shadow-pill:0 8px 24px -8px rgba(0,0,0,.12);
      --ease-brand:cubic-bezier(.22,1,.36,1); --dur-fast:140ms;
    }
    * { box-sizing:border-box; }
    body { margin:0; font-family:var(--font-sans); font-size:14px; line-height:1.5;
      color:var(--color-text); background:var(--color-background-muted);
      -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; }
    h1 { font-size:1.75rem; font-weight:800; letter-spacing:-0.02em; margin:0 0 4px; }
    h2 { font-size:1.05rem; font-weight:700; letter-spacing:-0.01em; margin:0 0 12px; }
    h3 { font-size:.95rem; font-weight:600; margin:8px 0 6px; }
    p { text-wrap:pretty; }
    a { color:var(--color-primary); text-decoration:none; text-underline-offset:2px; }
    a:hover { color:var(--color-primary-hover); }
    code,pre,kbd { font-family:var(--font-mono); }
    :focus-visible { outline:none; box-shadow:0 0 0 3px var(--primary-ring); border-radius:var(--radius-sm); }
    ::selection { background:color-mix(in srgb,var(--color-primary) 15%,transparent); }

    /* === Header (nav glass, firma de marca) === */
    header { position:sticky; top:0; z-index:10;
      display:flex; align-items:center; gap:20px; padding:12px 24px;
      background:color-mix(in srgb,var(--color-background) 80%,transparent);
      backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
      border-bottom:1px solid var(--color-border); }
    header .brand { display:flex; align-items:center; gap:10px; }
    header .brand .logo { height:22px; }
    header .brand .tag { font-size:11px; font-weight:600; color:var(--color-primary);
      background:var(--primary-soft); border:1px solid color-mix(in srgb,var(--color-primary) 30%,transparent);
      padding:1px 8px; border-radius:var(--radius-full); letter-spacing:.02em; }
    header nav { display:flex; gap:4px; margin-left:auto; }
    header nav a { color:var(--color-text-muted); font-size:13px; font-weight:500;
      padding:6px 12px; border-radius:var(--radius-md); transition:all var(--dur-fast) var(--ease-brand); }
    header nav a:hover { color:var(--color-text); background:var(--color-background-muted); }

    main { max-width:1040px; margin:0 auto; padding:28px 24px 64px; }
    .sub { color:var(--color-text-muted); margin:0 0 20px; }

    /* === Cards & panels === */
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:14px; }
    .card { display:block; background:var(--color-background); border:1px solid var(--color-border);
      border-radius:var(--radius-xl); padding:16px; color:inherit; box-shadow:var(--shadow-sm);
      transition:all var(--dur-fast) var(--ease-brand); }
    .card:hover { border-color:var(--color-primary); box-shadow:var(--shadow-md); transform:translateY(-1px); }
    .card h3 { margin:8px 0 6px; }
    .card p { margin:0; color:var(--color-text-muted); font-size:13px;
      display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .card .src { margin-top:8px; font-size:12px; color:var(--color-muted); }
    .card-head { margin-bottom:4px; }
    .panel { background:var(--color-background); border:1px solid var(--color-border);
      border-radius:var(--radius-xl); padding:18px; margin-bottom:18px; box-shadow:var(--shadow-sm); }

    /* === Badges / chips === */
    .badge { display:inline-block; font-size:11px; padding:1px 8px; border-radius:var(--radius-full);
      margin-right:4px; font-weight:600; }

    /* === Forms === */
    form.row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    input[type=text],input[type=date],select,textarea { font:inherit; padding:8px 11px;
      border:1px solid var(--color-border); border-radius:var(--radius-lg); background:var(--color-background);
      color:var(--color-text); }
    input[type=text] { flex:1; min-width:220px; }
    input::placeholder { color:var(--color-muted); }
    input:focus-visible,select:focus-visible,textarea:focus-visible { border-color:var(--color-primary); box-shadow:0 0 0 3px var(--primary-ring); }
    textarea { width:100%; min-height:84px; font-family:var(--font-sans); }
    button { font:inherit; font-weight:500; padding:8px 16px; border:1px solid transparent;
      border-radius:var(--radius-lg); background:var(--color-primary); color:#fff; cursor:pointer;
      transition:all var(--dur-fast) var(--ease-brand); }
    button:hover { background:var(--color-primary-hover); }
    button:active { transform:translateY(1px); }
    button.secondary { background:var(--color-background); color:var(--color-text); border-color:var(--color-border); }
    button.secondary:hover { background:var(--color-background-muted); }

    /* === Misc === */
    .meta { display:grid; grid-template-columns:140px 1fr; gap:6px 12px; margin:14px 0; }
    .meta dt { color:var(--color-text-muted); }
    .content-block { white-space:pre-wrap; background:var(--color-background-muted);
      border:1px solid var(--color-border); border-radius:var(--radius-md); padding:14px; font-family:var(--font-mono); font-size:13px; }
    .answer { background:var(--color-background); border:1px solid var(--color-border);
      border-left:3px solid var(--color-primary); border-radius:var(--radius-xl); padding:4px 18px; margin:14px 0; box-shadow:var(--shadow-sm); }
    .answer p { margin:10px 0; color:var(--color-text); }
    .answer ul { margin:10px 0; padding-left:22px; }
    .answer li { margin:4px 0; }
    .warn { background:#fff8e6; border:1px solid #d4a72c55; border-radius:var(--radius-md); padding:12px; margin:10px 0; }
    .warn.contradiction { background:#ffeceb; border-color:#cf222e55; }
    .tags a { font-size:13px; color:var(--color-primary); margin-right:10px; }
    .filters { margin-bottom:16px; }
    .pill { display:inline-block; padding:4px 12px; border:1px solid var(--color-border); border-radius:var(--radius-full);
      color:var(--color-text-muted); font-size:13px; margin:0 4px 4px 0; background:var(--color-background); transition:all var(--dur-fast) var(--ease-brand); }
    .pill:hover { border-color:var(--color-primary); color:var(--color-text); }
    .pill.active { background:var(--color-primary); color:#fff; border-color:var(--color-primary); }
    .empty { color:var(--color-text-muted); padding:24px; text-align:center;
      background:var(--color-background); border:1px dashed var(--color-border); border-radius:var(--radius-xl); }
    a.back { color:var(--color-text-muted); font-size:13px; }
  </style>
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
      ${user ? `<span style="margin-left:12px;color:var(--color-text-muted)">${esc(user.email)}${user.admin ? ' <span class="pill" style="padding:1px 6px">admin</span>' : ""}</span> <a href="/logout">Salir</a>` : ""}
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}
