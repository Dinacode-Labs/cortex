import { readFileSync } from "node:fs";

/**
 * Utilidades de transcript (puras / de lectura) compartidas por la destilación y el
 * pipeline de captura de sesiones de agente: borrado de secretos, limpieza de ruido,
 * extracción de texto por rol, condensado de un .jsonl a diálogo y troceado en ventanas.
 *
 * Env: CORTEX_SESSIONS_MAX_WINDOWS (def 8), CORTEX_SESSIONS_WINDOW_CHARS (def 9000),
 *      CORTEX_SESSIONS_TURN_CHARS (def 2500).
 */

const MAX_WINDOWS = Number(process.env.CORTEX_SESSIONS_MAX_WINDOWS ?? "8");
const WINDOW_CHARS = Number(process.env.CORTEX_SESSIONS_WINDOW_CHARS ?? "9000");
const TURN_CHARS = Number(process.env.CORTEX_SESSIONS_TURN_CHARS ?? "2500");

/** Borra secretos antes de mandar al LLM o de guardar (best-effort, amplio). */
export function scrub(s: string): string {
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
export function condenseSession(file: string): string {
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
export function windows(text: string): string[] {
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
