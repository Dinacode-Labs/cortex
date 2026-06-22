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

const STATUS_COLORS: Record<string, string> = {
  validated: "#1a7f37",
  verified: "#1a7f37",
  pending_validation: "#9a6700",
  draft: "#0969da",
  rejected: "#cf222e",
  obsolete: "#6e7781",
  superseded: "#8250df",
};

const TYPE_COLORS: Record<string, string> = {
  decision: "#0969da",
  constraint: "#9a6700",
  incident: "#cf222e",
  risk: "#bc4c00",
  technical_debt: "#6e4cff",
  architecture: "#1a7f37",
  convention: "#57606a",
};

export function badge(text: string, color: string): string {
  return `<span class="badge" style="background:${color}1a;color:${color};border:1px solid ${color}55">${esc(text)}</span>`;
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

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Dinacode Cortex</title>
  <style>
    :root { --bg:#f6f8fa; --fg:#1f2328; --muted:#57606a; --line:#d0d7de; --accent:#6e4cff; }
    * { box-sizing: border-box; }
    body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:var(--fg); background:var(--bg); }
    header { background:#0d1117; color:#fff; padding:14px 24px; display:flex; align-items:center; gap:16px; }
    header .logo { font-weight:700; letter-spacing:.5px; }
    header .logo b { color:var(--accent); }
    header nav a { color:#c9d1d9; text-decoration:none; margin-right:14px; font-size:14px; }
    header nav a:hover { color:#fff; }
    main { max-width:1000px; margin:0 auto; padding:24px; }
    h1 { font-size:22px; margin:0 0 4px; }
    .sub { color:var(--muted); margin:0 0 20px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; }
    .card { display:block; background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px; text-decoration:none; color:inherit; transition:.1s; }
    .card:hover { border-color:var(--accent); box-shadow:0 2px 10px #0001; }
    .card h3 { margin:8px 0 6px; font-size:15px; }
    .card p { margin:0; color:var(--muted); font-size:13px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .card .src { margin-top:8px; font-size:12px; color:var(--muted); }
    .badge { display:inline-block; font-size:11px; padding:1px 7px; border-radius:20px; margin-right:4px; font-weight:600; }
    .card-head { margin-bottom:4px; }
    .panel { background:#fff; border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:18px; }
    .panel h2 { margin:0 0 12px; font-size:16px; }
    form.row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    input[type=text], select, textarea { font:inherit; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    input[type=text] { flex:1; min-width:200px; }
    textarea { width:100%; min-height:80px; }
    button { font:inherit; font-weight:600; padding:8px 16px; border:0; border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; }
    button.secondary { background:#eaeef2; color:var(--fg); }
    .meta { display:grid; grid-template-columns:140px 1fr; gap:6px 12px; margin:14px 0; }
    .meta dt { color:var(--muted); }
    .content-block { white-space:pre-wrap; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:14px; }
    .answer { background:#fff; border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:8px; padding:4px 18px; margin:14px 0; }
    .answer p { margin:10px 0; }
    .answer ul { margin:10px 0; padding-left:22px; }
    .answer li { margin:4px 0; }
    .warn { background:#fff8c5; border:1px solid #d4a72c66; border-radius:8px; padding:12px; margin:10px 0; }
    .warn.contradiction { background:#ffebe9; border-color:#cf222e66; }
    .tags a { font-size:13px; color:var(--accent); text-decoration:none; margin-right:10px; }
    .filters { margin-bottom:16px; }
    .pill { display:inline-block; padding:3px 12px; border:1px solid var(--line); border-radius:20px; text-decoration:none; color:var(--muted); font-size:13px; margin:0 4px 4px 0; background:#fff; }
    .pill.active { background:var(--accent); color:#fff; border-color:var(--accent); }
    .empty { color:var(--muted); padding:20px; text-align:center; }
    a.back { color:var(--muted); text-decoration:none; font-size:14px; }
  </style>
</head>
<body>
  <header>
    <span class="logo">Dinacode <b>Cortex</b></span>
    <nav>
      <a href="/">Inicio</a>
      <a href="/ask">Preguntar</a>
      <a href="/graph">Grafo</a>
      <a href="/lint">Lint</a>
      <a href="/?capture=1">Capturar</a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}
