import { createInterface } from "node:readline/promises";
import {
  capture,
  getEntry,
  purgeEntries,
  readCortexLink,
  searchEntries,
  updateEntry,
  useProjectServer,
} from "@cortex/client";
import { writeBlocker } from "../compat.js";
import { describePurgeResult, isPurgeConfirmed, PURGE_CONFIRMATION } from "../purge.js";

/**
 * `cortex mem` -- the project's memory from the command line: store, search, read an entry and
 * correct it.
 *
 * It exists for two reasons. One, the API could write but not read: search was only available
 * over MCP, so from a terminal there was no way to query the memory. Two, it is the bridge the
 * `cortex.mem_*` tools Cortex registers in Pi use (ADR-0034): the extension does not speak HTTP
 * on its own, it calls here, and that way server and token resolution live in one place.
 *
 * `--json` for whoever consumes it from code; without it, readable output.
 *
 *   cortex mem save "<content>" [--title t] [--type decision] [--cwd dir] [--json]
 *   cortex mem search "<query>" [--limit 10] [--all] [--type t] [--cwd dir] [--json]
 *   cortex mem get <id> [--json]
 *   cortex mem update <id> [--title t] [--content c] [--json]
 */

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (!a.includes("=") && args[i + 1] && !args[i + 1]!.startsWith("--")) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

interface Output {
  json: boolean;
  ok: boolean;
  data: unknown;
  text: string;
}

function emit(s: Output): void {
  if (s.json) console.log(JSON.stringify(s.data));
  else console.log(s.text);
  if (!s.ok) process.exitCode = 1;
}

/** The project comes from the folder's `.cortex.json`, just as in the hooks. */
function slugDe(args: string[]): { slug: string } | { error: string } {
  const cwd = flag(args, "cwd") || process.cwd();
  useProjectServer(cwd); // pins which server is talked to BEFORE any call (ADR-0033)
  const link = readCortexLink(cwd);
  if (!link || link.ignore || !link.slug) {
    return { error: "This folder is not linked to a project. Run: cortex link <slug>" };
  }
  return { slug: link.slug };
}

async function save(args: string[], json: boolean): Promise<void> {
  const content = positional(args);
  if (!content) return emit({ json, ok: false, data: { error: "Missing content" }, text: 'Usage: cortex mem save "<content>" [--title t] [--type decision]' });
  const p = slugDe(args);
  if ("error" in p) return emit({ json, ok: false, data: p, text: `✗ ${p.error}` });
  // This writes: if this CLI is below the server's minimum, better not to half-store (ADR-0062).
  const block = await writeBlocker();
  if (block) return emit({ json, ok: false, data: { error: block }, text: `✗ ${block}` });

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
    return emit({ json, ok: false, data: { error }, text: `✗ ${error}` });
  }
  const action = (res.data as { action?: string })?.action ?? "saved";
  emit({ json, ok: true, data: res.data, text: `✓ ${action} in "${p.slug}"` });
}

async function search(args: string[], json: boolean): Promise<void> {
  const q = positional(args);
  if (!q) return emit({ json, ok: false, data: { error: "Missing query" }, text: 'Usage: cortex mem search "<query>" [--limit 10] [--all]' });

  // By default it searches this folder's project. `--all` searches everything accessible,
  // which is what you need when what you are looking for was learned in another repository.
  let slug: string | undefined;
  if (!args.includes("--all")) {
    const p = slugDe(args);
    if ("error" in p) return emit({ json, ok: false, data: p, text: `✗ ${p.error}` });
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
    return emit({ json, ok: false, data: { error }, text: `✗ ${error}` });
  }
  const hits = res.data.hits ?? [];
  const text = hits.length
    ? hits.map((h) => `• [${h.type}] ${h.title || "(untitled)"}\n  ${h.content.replace(/\s+/g, " ").slice(0, 160)}\n  id: ${h.id}`).join("\n\n")
    : "No results.";
  emit({ json, ok: true, data: res.data, text });
}

async function get(args: string[], json: boolean): Promise<void> {
  const id = positional(args);
  if (!id) return emit({ json, ok: false, data: { error: "Missing id" }, text: "Usage: cortex mem get <id>" });
  useProjectServer(flag(args, "cwd") || process.cwd());
  const res = await getEntry(id);
  if (!res.ok) {
    const error = (res.data as { error?: string })?.error ?? `HTTP ${res.status}`;
    return emit({ json, ok: false, data: { error }, text: `✗ ${error}` });
  }
  const e = res.data.entry;
  emit({ json, ok: true, data: res.data, text: `[${e.type}] ${e.title || "(untitled)"}\n\n${e.content}\n\nid: ${e.id}` });
}

async function update(args: string[], json: boolean): Promise<void> {
  const id = positional(args);
  const title = flag(args, "title");
  const content = flag(args, "content");
  if (!id) return emit({ json, ok: false, data: { error: "Missing id" }, text: "Usage: cortex mem update <id> [--title t] [--content c]" });
  if (title === undefined && content === undefined) {
    return emit({ json, ok: false, data: { error: "Nothing to update" }, text: "Nothing to update: pass --title, --content, or both." });
  }
  useProjectServer(flag(args, "cwd") || process.cwd());
  const block = await writeBlocker();
  if (block) return emit({ json, ok: false, data: { error: block }, text: `✗ ${block}` });
  const res = await updateEntry(id, { title, content });
  if (!res.ok) {
    const error = (res.data as { error?: string })?.error ?? `HTTP ${res.status}`;
    return emit({ json, ok: false, data: { error }, text: `✗ ${error}` });
  }
  emit({ json, ok: true, data: res.data, text: `✓ updated ${id}` });
}

function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--yes" || a === "--json") continue;
    if (a.startsWith("--")) {
      if (!a.includes("=") && args[i + 1] && !args[i + 1]!.startsWith("--")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

async function confirmPurge(ids: string[]): Promise<boolean> {
  console.log(`About to purge ${ids.length === 1 ? "this entry" : `these ${ids.length} entries`} for good:`);
  for (const id of ids) {
    const res = await getEntry(id);
    const title = res.ok ? res.data.entry.title || "(untitled)" : `(${(res.data as { error?: string })?.error ?? `HTTP ${res.status}`})`;
    console.log(`  • ${title}\n    id: ${id}`);
  }
  console.log("It cannot be undone: no search, pack or screen will return them again.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return isPurgeConfirmed(await rl.question(`Type "${PURGE_CONFIRMATION}" to confirm: `));
  } finally {
    rl.close();
  }
}

async function purge(args: string[], json: boolean): Promise<void> {
  const ids = positionals(args);
  if (!ids.length) return emit({ json, ok: false, data: { error: "Missing id" }, text: "Usage: cortex mem purge <id> [<id>...] [--yes]" });
  useProjectServer(flag(args, "cwd") || process.cwd());
  const block = await writeBlocker();
  if (block) return emit({ json, ok: false, data: { error: block }, text: `✗ ${block}` });

  if (!args.includes("--yes")) {
    if (json || !process.stdin.isTTY) {
      return emit({ json, ok: false, data: { error: "Purging is irreversible: pass --yes" }, text: "✗ Purging is irreversible: pass --yes to confirm." });
    }
    if (!(await confirmPurge(ids))) return emit({ json, ok: false, data: { error: "Not confirmed" }, text: "Nothing purged." });
  }

  const res = await purgeEntries(ids);
  const outcome = describePurgeResult(res);
  emit({
    json,
    ok: outcome.ok,
    data: outcome.ok ? res.data : { error: outcome.message },
    text: `${outcome.ok ? "✓" : "✗"} ${outcome.message}`,
  });
}

export async function run(args: string[] = []): Promise<void> {
  const json = args.includes("--json");
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "save") await save(rest, json);
  else if (sub === "search") await search(rest, json);
  else if (sub === "get") await get(rest, json);
  else if (sub === "update") await update(rest, json);
  else if (sub === "purge") await purge(rest, json);
  else {
    console.log("Usage: cortex mem <save|search|get|update|purge> [--json]\n");
    console.log('  cortex mem save "<content>" [--title t] [--type decision]');
    console.log('  cortex mem search "<query>" [--limit 10] [--all]');
    console.log("  cortex mem get <id>");
    console.log("  cortex mem update <id> [--title t] [--content c]");
    console.log("  cortex mem purge <id> [<id>...] [--yes]");
  }
}
