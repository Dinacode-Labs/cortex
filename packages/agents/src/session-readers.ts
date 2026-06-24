import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Lectores del STORE de sesiones de cada agente, para el backfill de auto-captura.
 * Cada uno produce, para un repo (cwd), una lista de { sessionId, condensed } con el
 * diálogo útil (sin tool calls). El pipeline compartido (captureCondensedViaApi) destila
 * y POSTea por la API autenticada. Construidos según los formatos documentados de cada
 * agente; defensivos (si el store no existe o cambia el formato → devuelven []).
 * Ver docs/research/hooks-integration.md.
 */
export interface RawSession {
  sessionId: string;
  condensed: string;
}

const MAX_MSG = 2000;
const MAX_TOTAL = 60_000;

/** Une mensajes {role,text} en un transcript legible (cap por mensaje y total). */
function condenseMessages(msgs: { role: string; text: string }[]): string {
  const out: string[] = [];
  let total = 0;
  for (const m of msgs) {
    const t = (m.text ?? "").trim();
    if (!t || (m.role !== "user" && m.role !== "assistant")) continue;
    const chunk = `[${m.role}] ${t.slice(0, MAX_MSG)}`;
    out.push(chunk);
    total += chunk.length;
    if (total > MAX_TOTAL) break;
  }
  return out.join("\n\n");
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// --- Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl ----------------------
function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (safe(() => statSync(p).isDirectory(), false)) out.push(...walkJsonl(p));
    else if (name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

export function readCodexSessions(repoPath: string): RawSession[] {
  const root = process.env.CORTEX_CODEX_DIR || join(homedir(), ".codex", "sessions");
  const target = resolve(repoPath);
  const sessions: RawSession[] = [];
  for (const file of walkJsonl(root)) {
    const lines = safe(() => readFileSync(file, "utf8").split("\n").filter(Boolean), [] as string[]);
    let cwd = "";
    const msgs: { role: string; text: string }[] = [];
    for (const line of lines) {
      const row = safe(() => JSON.parse(line) as { type?: string; payload?: any }, null);
      if (!row) continue;
      if (row.type === "session_meta") cwd = row.payload?.cwd ?? cwd;
      if (row.type === "response_item" && row.payload?.type === "message") {
        const role = row.payload.role as string;
        const text = Array.isArray(row.payload.content)
          ? row.payload.content.filter((c: any) => c?.type === "input_text" || c?.type === "output_text").map((c: any) => c.text).join("\n")
          : "";
        if (text) msgs.push({ role, text });
      }
    }
    if (resolve(cwd || "") !== target) continue; // solo sesiones de este repo
    const condensed = condenseMessages(msgs);
    if (condensed) sessions.push({ sessionId: file.split("/").pop()!.replace(/\.jsonl$/, ""), condensed });
  }
  return sessions;
}

// --- OpenCode: ~/.local/share/opencode/storage/{session,message,part} ---------
export function readOpenCodeSessions(repoPath: string): RawSession[] {
  const base = process.env.CORTEX_OPENCODE_DIR || join(homedir(), ".local/share/opencode/storage");
  const target = resolve(repoPath);
  const sessionsDir = join(base, "session");
  if (!existsSync(sessionsDir)) return [];
  const out: RawSession[] = [];
  for (const projectId of readdirSync(sessionsDir)) {
    const pdir = join(sessionsDir, projectId);
    if (!safe(() => statSync(pdir).isDirectory(), false)) continue;
    for (const f of readdirSync(pdir)) {
      if (!f.endsWith(".json")) continue;
      const info = safe(() => JSON.parse(readFileSync(join(pdir, f), "utf8")) as { id?: string; directory?: string; parentID?: string }, null);
      if (!info?.id || info.parentID) continue; // saltar subagentes
      if (info.directory && resolve(info.directory) !== target) continue;
      const sid = info.id;
      const msgDir = join(base, "message", sid);
      if (!existsSync(msgDir)) continue;
      const msgs: { role: string; text: string }[] = [];
      const msgFiles = safe(() => readdirSync(msgDir).filter((x) => x.endsWith(".json")).sort(), [] as string[]);
      for (const mf of msgFiles) {
        const msg = safe(() => JSON.parse(readFileSync(join(msgDir, mf), "utf8")) as { id?: string; role?: string }, null);
        if (!msg?.id || !msg.role) continue;
        const partDir = join(base, "part", msg.id);
        const text = safe(
          () =>
            readdirSync(partDir)
              .filter((x) => x.endsWith(".json"))
              .map((pf) => JSON.parse(readFileSync(join(partDir, pf), "utf8")) as { type?: string; text?: string; synthetic?: boolean; ignored?: boolean })
              .filter((p) => p.type === "text" && p.text && !p.synthetic && !p.ignored)
              .map((p) => p.text)
              .join("\n"),
          "",
        );
        if (text) msgs.push({ role: msg.role, text });
      }
      const condensed = condenseMessages(msgs);
      if (condensed) out.push({ sessionId: sid, condensed });
    }
  }
  return out;
}

// --- Hermes: ~/.hermes/state.db (SQLite: sessions, messages) ------------------
export async function readHermesSessions(repoPath: string): Promise<RawSession[]> {
  const dbPath = process.env.CORTEX_HERMES_DB || join(homedir(), ".hermes", "state.db");
  if (!existsSync(dbPath)) return [];
  let DatabaseSync: any;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    console.error("  (node:sqlite no disponible; Hermes requiere Node ≥ 22)");
    return [];
  }
  const target = resolve(repoPath);
  const out: RawSession[] = [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    // sessions.cwd puede no existir; filtramos por cwd si está, si no, todas.
    const cols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
    const hasCwd = cols.includes("cwd");
    const sessRows = (hasCwd ? db.prepare("SELECT id, cwd FROM sessions").all() : db.prepare("SELECT id FROM sessions").all()) as { id: string; cwd?: string }[];
    const stmt = db.prepare("SELECT role, content FROM messages WHERE session_id = ? ORDER BY rowid ASC");
    for (const s of sessRows) {
      if (hasCwd && s.cwd && resolve(s.cwd) !== target) continue;
      const rows = stmt.all(s.id) as { role: string; content: string }[];
      const condensed = condenseMessages(rows.map((r) => ({ role: r.role, text: r.content })));
      if (condensed) out.push({ sessionId: s.id, condensed });
    }
    db.close();
  } catch (e) {
    console.error(`  (no se pudo leer ${dbPath}: ${(e as Error).message})`);
  }
  return out;
}

export async function readSessions(platform: string, repoPath: string): Promise<RawSession[]> {
  if (platform === "codex") return readCodexSessions(repoPath);
  if (platform === "opencode") return readOpenCodeSessions(repoPath);
  if (platform === "hermes") return readHermesSessions(repoPath);
  return [];
}
