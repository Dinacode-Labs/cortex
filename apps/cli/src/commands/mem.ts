import {
  capture,
  getEntry,
  readCortexLink,
  searchEntries,
  updateEntry,
  useProjectServer,
} from "@cortex/client";
import { writeBlocker } from "../compat.js";

/**
 * `cortex mem` — memoria del proyecto desde la línea de órdenes: guardar, buscar, leer una
 * entrada y corregirla.
 *
 * Existe por dos motivos. Uno, que la API sabía escribir pero no leer: buscar solo estaba
 * disponible por MCP, así que desde un terminal no había forma de consultar la memoria. Dos,
 * que es el puente que usan las tools `cortex.mem_*` que Cortex registra en Pi (ADR-0034):
 * la extensión no habla HTTP por su cuenta, llama aquí, y así la resolución del servidor y
 * del token vive en un solo sitio.
 *
 * `--json` para quien lo consume desde código; sin él, salida legible.
 *
 *   cortex mem save "<contenido>" [--title t] [--type decision] [--cwd dir] [--json]
 *   cortex mem search "<consulta>" [--limit 10] [--all] [--type t] [--cwd dir] [--json]
 *   cortex mem get <id> [--json]
 *   cortex mem update <id> [--title t] [--content c] [--json]
 */

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

/** El primer argumento que no es una opción ni el valor de una. */
function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (!a.includes("=") && args[i + 1] && !args[i + 1]!.startsWith("--")) i++; // salta su valor
      continue;
    }
    return a;
  }
  return undefined;
}

interface Salida {
  json: boolean;
  ok: boolean;
  data: unknown;
  texto: string;
}

function emite(s: Salida): void {
  if (s.json) console.log(JSON.stringify(s.data));
  else console.log(s.texto);
  if (!s.ok) process.exitCode = 1;
}

/** El proyecto sale del `.cortex.json` de la carpeta, igual que en los hooks. */
function slugDe(args: string[]): { slug: string } | { error: string } {
  const cwd = flag(args, "cwd") || process.cwd();
  useProjectServer(cwd); // fija a qué servidor se habla ANTES de cualquier llamada (ADR-0033)
  const link = readCortexLink(cwd);
  if (!link || link.ignore || !link.slug) {
    return { error: "This folder is not linked to a project. Run: cortex link <slug>" };
  }
  return { slug: link.slug };
}

async function save(args: string[], json: boolean): Promise<void> {
  const content = positional(args);
  if (!content) return emite({ json, ok: false, data: { error: "Missing content" }, texto: 'Usage: cortex mem save "<content>" [--title t] [--type decision]' });
  const p = slugDe(args);
  if ("error" in p) return emite({ json, ok: false, data: p, texto: `✗ ${p.error}` });
  // Escribe: si este CLI está por debajo del mínimo del servidor, mejor no guardar a medias (ADR-0060).
  const bloqueo = await writeBlocker();
  if (bloqueo) return emite({ json, ok: false, data: { error: bloqueo }, texto: `✗ ${bloqueo}` });

  const res = await capture({
    slug: p.slug,
    content,
    title: flag(args, "title"),
    type: flag(args, "type") as never,
    sourceType: "manual",
    sourceReference: flag(args, "ref"),
  });
  if (!res.ok) {
    const error = (res.data as { error?: string })?.error ?? `HTTP ${res.status}`;
    return emite({ json, ok: false, data: { error }, texto: `✗ ${error}` });
  }
  const action = (res.data as { action?: string })?.action ?? "saved";
  emite({ json, ok: true, data: res.data, texto: `✓ ${action} in "${p.slug}"` });
}

async function search(args: string[], json: boolean): Promise<void> {
  const q = positional(args);
  if (!q) return emite({ json, ok: false, data: { error: "Missing query" }, texto: 'Usage: cortex mem search "<query>" [--limit 10] [--all]' });

  // Por defecto se busca en el proyecto de esta carpeta. `--all` busca en todo lo accesible,
  // que es lo que hace falta cuando lo que buscas lo aprendiste en otro repositorio.
  let slug: string | undefined;
  if (!args.includes("--all")) {
    const p = slugDe(args);
    if ("error" in p) return emite({ json, ok: false, data: p, texto: `✗ ${p.error}` });
    slug = p.slug;
  } else {
    useProjectServer(flag(args, "cwd") || process.cwd());
  }

  const limite = Number(flag(args, "limit") ?? "10");
  const res = await searchEntries({
    q,
    slug,
    type: flag(args, "type") as never,
    limit: Number.isFinite(limite) ? Math.min(Math.max(Math.trunc(limite), 1), 50) : 10,
  });
  if (!res.ok) {
    const error = (res.data as { error?: string })?.error ?? `HTTP ${res.status}`;
    return emite({ json, ok: false, data: { error }, texto: `✗ ${error}` });
  }
  const hits = res.data.hits ?? [];
  const texto = hits.length
    ? hits.map((h) => `• [${h.type}] ${h.title || "(untitled)"}\n  ${h.content.replace(/\s+/g, " ").slice(0, 160)}\n  id: ${h.id}`).join("\n\n")
    : "No results.";
  emite({ json, ok: true, data: res.data, texto });
}

async function get(args: string[], json: boolean): Promise<void> {
  const id = positional(args);
  if (!id) return emite({ json, ok: false, data: { error: "Missing id" }, texto: "Usage: cortex mem get <id>" });
  useProjectServer(flag(args, "cwd") || process.cwd());
  const res = await getEntry(id);
  if (!res.ok) {
    const error = (res.data as { error?: string })?.error ?? `HTTP ${res.status}`;
    return emite({ json, ok: false, data: { error }, texto: `✗ ${error}` });
  }
  const e = res.data.entry;
  emite({ json, ok: true, data: res.data, texto: `[${e.type}] ${e.title || "(untitled)"}\n\n${e.content}\n\nid: ${e.id}` });
}

async function update(args: string[], json: boolean): Promise<void> {
  const id = positional(args);
  const title = flag(args, "title");
  const content = flag(args, "content");
  if (!id) return emite({ json, ok: false, data: { error: "Missing id" }, texto: "Usage: cortex mem update <id> [--title t] [--content c]" });
  if (title === undefined && content === undefined) {
    return emite({ json, ok: false, data: { error: "Nothing to update" }, texto: "Nothing to update: pass --title, --content, or both." });
  }
  useProjectServer(flag(args, "cwd") || process.cwd());
  const bloqueo = await writeBlocker();
  if (bloqueo) return emite({ json, ok: false, data: { error: bloqueo }, texto: `✗ ${bloqueo}` });
  const res = await updateEntry(id, { title, content });
  if (!res.ok) {
    const error = (res.data as { error?: string })?.error ?? `HTTP ${res.status}`;
    return emite({ json, ok: false, data: { error }, texto: `✗ ${error}` });
  }
  emite({ json, ok: true, data: res.data, texto: `✓ updated ${id}` });
}

export async function run(args: string[] = []): Promise<void> {
  const json = args.includes("--json");
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "save") await save(rest, json);
  else if (sub === "search") await search(rest, json);
  else if (sub === "get") await get(rest, json);
  else if (sub === "update") await update(rest, json);
  else {
    console.log("Usage: cortex mem <save|search|get|update> [--json]\n");
    console.log('  cortex mem save "<content>" [--title t] [--type decision]');
    console.log('  cortex mem search "<query>" [--limit 10] [--all]');
    console.log("  cortex mem get <id>");
    console.log("  cortex mem update <id> [--title t] [--content c]");
  }
}
