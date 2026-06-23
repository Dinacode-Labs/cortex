import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeSql, getSql } from "@cortex/database";
import { saveContext } from "@cortex/core";
import { contextEntryType } from "@cortex/shared";
import type { ContextEntryType } from "@cortex/shared";
import { runAgent, shutdownObservability } from "./mastra.js";

/**
 * Backfill de conversaciones de agente → Cortex, DEPURADAS (roadmap). Lee las sesiones
 * de un agente en un proyecto, extrae el diálogo útil (descartando tool calls, volcados
 * y thinking), borra secretos, y **destila con LLM** a conocimiento TIPADO
 * (decisiones/restricciones/incidencias/convenciones…), que guarda con proveniencia.
 * NO ingiere el transcript crudo. Complementa a los hooks (esto es batch/retroactivo).
 *
 * v1: plataforma Claude Code (~/.claude/projects/<ruta-saneada>/*.jsonl).
 * Uso: tsx src/connect-sessions.ts "<Proyecto>" <ruta-repo> [claude]
 * Env: CORTEX_SESSIONS_MAX_WINDOWS (def 8), CORTEX_SESSIONS_WINDOW_CHARS (def 9000),
 *      CORTEX_SESSIONS_TURN_CHARS (def 2500), CORTEX_SESSIONS_LIMIT (nº sesiones).
 */

const TYPES = contextEntryType.options as readonly string[];
const MAX_WINDOWS = Number(process.env.CORTEX_SESSIONS_MAX_WINDOWS ?? "8");
const WINDOW_CHARS = Number(process.env.CORTEX_SESSIONS_WINDOW_CHARS ?? "9000");
const TURN_CHARS = Number(process.env.CORTEX_SESSIONS_TURN_CHARS ?? "2500");

/** Borra secretos antes de mandar al LLM o de guardar (best-effort, amplio). */
function scrub(s: string): string {
  return s
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED_KEY]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, "[REDACTED_JWT]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED]")
    .replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]")
    .replace(/GOCSPX-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/g, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|apikey|token|secret|password|passwd|pwd|access[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._\-\/+]{12,}["']?/gi, "$1=[REDACTED]");
}

function clean(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, "")
    .replace(/<local-command-[a-z-]+>[\s\S]*?<\/local-command-[a-z-]+>/g, "")
    .trim();
}

interface Block { type?: string; text?: string }
function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Block[]).filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n");
  }
  return "";
}
function assistantText(content: unknown): string {
  if (Array.isArray(content)) {
    return (content as Block[]).filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n");
  }
  return "";
}

/** Lee un .jsonl de sesión → diálogo condensado (USUARIO/ASISTENTE), sin ruido ni secretos. */
function condenseSession(file: string): string {
  const turns: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o: { type?: string; message?: { role?: string; content?: unknown } };
    try { o = JSON.parse(line); } catch { continue; }
    const role = o.message?.role;
    if (o.type === "user" && role === "user") {
      const t = clean(userText(o.message?.content));
      if (t) turns.push(`USUARIO: ${t.slice(0, TURN_CHARS)}`);
    } else if (o.type === "assistant" && role === "assistant") {
      const t = clean(assistantText(o.message?.content));
      if (t) turns.push(`ASISTENTE: ${t.slice(0, TURN_CHARS)}`);
    }
  }
  return scrub(turns.join("\n\n"));
}

/** Trocea el diálogo en ventanas (~WINDOW_CHARS), cap MAX_WINDOWS. */
function windows(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const turn of text.split("\n\n")) {
    if (buf.length + turn.length > WINDOW_CHARS && buf) {
      out.push(buf);
      if (out.length >= MAX_WINDOWS) return out;
      buf = "";
    }
    buf += (buf ? "\n\n" : "") + turn;
  }
  if (buf && out.length < MAX_WINDOWS) out.push(buf);
  return out;
}

interface Item { type: string; title: string; content: string }
function extractJson(raw: string): string {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  return s >= 0 && e > s ? raw.slice(s, e + 1) : raw;
}

async function distill(project: string, window: string): Promise<Item[]> {
  const prompt = `Proyecto: "${project}". Fragmento de transcript de una sesión de un agente de IA trabajando en este proyecto:
"""
${window}
"""
Extrae SOLO el conocimiento DURADERO y reutilizable como JSON:
{"items":[{"type": uno de [${TYPES.join(", ")}], "title": "título corto", "content": "el conocimiento en 1-3 frases"}]}
Incluye decisiones técnicas, restricciones, incidencias y su resolución, convenciones, deuda técnica, riesgos y how-tos. DESCARTA ruido (llamadas a herramientas, volcados de ficheros, narración, saludos, intentos abandonados). NUNCA incluyas secretos/claves. Si no hay nada que valga, devuelve {"items":[]}.`;
  try {
    const raw = await runAgent("distiller", prompt, { maxOutputTokens: 1500 });
    const parsed = JSON.parse(extractJson(raw)) as { items?: { type?: string; title?: string; content?: string }[] };
    return (parsed.items ?? [])
      .filter((i): i is Item => Boolean(i?.title && i?.content))
      .map((i) => ({ type: TYPES.includes(i.type ?? "") ? (i.type as string) : "module_note", title: i.title.trim().slice(0, 160), content: i.content.trim() }));
  } catch (e) {
    console.error(`  ✗ destilación falló en una ventana: ${(e as Error).message}`);
    return [];
  }
}

async function alreadyIngested(project: string, sessionId: string): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    SELECT 1 FROM context_entries ce JOIN entities p ON p.id = ce.project_id
    WHERE p.name = ${project} AND ce.source_type = 'agent_session' AND ce.source_reference = ${sessionId} LIMIT 1
  `) as unknown as unknown[];
  return rows.length > 0;
}

async function main(): Promise<void> {
  const project = process.argv[2];
  const repoPath = process.argv[3];
  const platform = (process.argv[4] ?? "claude").toLowerCase();
  if (!project || !repoPath) {
    console.error('Uso: tsx src/connect-sessions.ts "<Proyecto>" <ruta-repo> [claude]');
    process.exitCode = 1;
    return;
  }
  if (platform !== "claude") {
    console.error(`Plataforma "${platform}" aún no soportada (v1: claude).`);
    process.exitCode = 1;
    return;
  }

  const folder = join(homedir(), ".claude/projects", repoPath.replace(/[^a-zA-Z0-9]/g, "-"));
  if (!existsSync(folder)) {
    console.error(`No hay sesiones de Claude para ${repoPath} (${folder} no existe).`);
    process.exitCode = 1;
    return;
  }
  let files = readdirSync(folder).filter((f) => f.endsWith(".jsonl")).map((f) => join(folder, f));
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const limit = process.env.CORTEX_SESSIONS_LIMIT ? Number(process.env.CORTEX_SESSIONS_LIMIT) : undefined;
  if (limit) files = files.slice(0, limit);
  console.log(`${files.length} sesiones en ${folder}. Destilando → "${project}"...`);

  let savedTotal = 0;
  let skipped = 0;
  for (const file of files) {
    const sessionId = file.split("/").pop()!.replace(/\.jsonl$/, "");
    if (await alreadyIngested(project, sessionId)) { skipped++; continue; }
    const condensed = condenseSession(file);
    if (condensed.length < 200) continue;
    const wins = windows(condensed);
    const items: Item[] = [];
    const seen = new Set<string>();
    for (const w of wins) {
      for (const it of await distill(project, w)) {
        const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
        if (key.length < 3 || seen.has(key)) continue;
        seen.add(key);
        items.push(it);
      }
    }
    let saved = 0;
    for (const it of items) {
      try {
        await saveContext(
          {
            content: scrub(`${it.title}\n\n${it.content}`),
            project,
            title: it.title,
            type: it.type as ContextEntryType,
            sourceType: "agent_session",
            sourceReference: sessionId,
            createdBy: "session-backfill",
            metadata: { platform, sessionId },
          },
          { useClassifier: false, detectImprovements: false, skipEmbedding: false },
        );
        saved++;
      } catch (e) {
        console.error(`  ✗ guardando "${it.title}": ${(e as Error).message}`);
      }
    }
    savedTotal += saved;
    console.log(`  ${sessionId.slice(0, 8)}…: ${wins.length} ventanas → ${saved} entradas`);
  }
  console.log(`Backfill completado: ${savedTotal} entradas de ${files.length - skipped} sesiones (${skipped} ya ingeridas).`);
}

main()
  .catch((e) => {
    console.error("Error en connect-sessions:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownObservability();
    await closeSql();
    process.exit(process.exitCode ?? 0);
  });
