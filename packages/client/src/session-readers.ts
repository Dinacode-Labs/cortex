import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/**
 * Lectores del STORE de sesiones de cada agente. Cada agente guarda sus conversaciones a su
 * manera —JSONL por sesión, ficheros sueltos por mensaje, SQLite— y aquí se traducen todas a
 * lo mismo: `{ sessionId, condensed }` con el diálogo útil, sin tool calls ni volcados.
 *
 * Se usan en dos sitios: el backfill (`connect-sessions`, que quiere TODAS las sesiones de un
 * repo) y el hook de captura (que quiere UNA, la que acaba de terminar). De ahí que cada
 * agente tenga las dos variantes.
 *
 * Defensivos por diseño: si el store no existe, cambia de formato o está a medio escribir,
 * devuelven vacío en vez de lanzar. Un hook no debe romper la sesión de nadie.
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

function codexRoot(): string {
  return process.env.CORTEX_CODEX_DIR || join(homedir(), ".codex", "sessions");
}

/** Lee un rollout de Codex. Devuelve también el `cwd` para poder filtrar por repo. */
function readCodexFile(file: string): (RawSession & { cwd: string }) | null {
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
  const condensed = condenseMessages(msgs);
  if (!condensed) return null;
  return { sessionId: basename(file).replace(/\.jsonl$/, ""), condensed, cwd };
}

/**
 * Localiza el rollout de una sesión. Codex nombra los ficheros
 * `rollout-<fecha>-<uuid>.jsonl` y los reparte por año/mes/día, así que el id que llega por
 * el hook no basta para construir la ruta: hay que buscarlo.
 */
export function findCodexRollout(sessionId: string): string | null {
  if (!sessionId) return null;
  const files = walkJsonl(codexRoot());
  const hit = files.find((f) => basename(f).includes(sessionId));
  if (hit) return hit;
  return null;
}

/** El rollout más reciente de un repo: el recurso cuando el hook no da el id de sesión. */
export function latestCodexRollout(repoPath: string): string | null {
  const target = resolve(repoPath);
  const files = walkJsonl(codexRoot())
    .map((f) => ({ f, m: safe(() => statSync(f).mtimeMs, 0) }))
    .sort((a, b) => b.m - a.m);
  for (const { f } of files.slice(0, 40)) {
    const s = readCodexFile(f);
    if (s && resolve(s.cwd || "") === target) return f;
  }
  return null;
}

/** Una sesión de Codex por ruta al rollout o por id. */
export function readCodexSession(ref: string): RawSession | null {
  const file = ref.endsWith(".jsonl") && existsSync(ref) ? ref : findCodexRollout(ref);
  if (!file) return null;
  const s = readCodexFile(file);
  return s ? { sessionId: s.sessionId, condensed: s.condensed } : null;
}

export function readCodexSessions(repoPath: string): RawSession[] {
  const target = resolve(repoPath);
  const sessions: RawSession[] = [];
  for (const file of walkJsonl(codexRoot())) {
    const s = readCodexFile(file);
    if (!s || resolve(s.cwd || "") !== target) continue; // solo sesiones de este repo
    sessions.push({ sessionId: s.sessionId, condensed: s.condensed });
  }
  return sessions;
}

/**
 * Carga `node:sqlite` sin que el bundler pueda tocar el nombre del módulo.
 *
 * Con el especificador literal, esbuild (vía tsup) reescribía `import("node:sqlite")` como
 * `import("sqlite")` —quitando el prefijo— al empaquetar el CLI. Ese módulo no existe, la
 * importación lanzaba, el `catch` devolvía vacío y la captura de OpenCode y de Hermes se iba
 * en silencio: funcionaba desde las fuentes y no funcionaba desde npm, que es la peor forma de
 * que algo esté roto. Partir la cadena impide la reescritura, porque el bundler ya no ve una
 * constante. Hay un test que comprueba el bundle (`tests/cli-smoke.test.ts`).
 */
async function cargaSqlite(): Promise<any | null> {
  const modulo = "node:" + "sqlite";
  try {
    return await import(/* @vite-ignore */ modulo);
  } catch {
    return null; // Node < 22.5
  }
}

// --- OpenCode: SQLite (opencode.db) y, si no, el store de ficheros antiguo -----
//
// OpenCode movió las sesiones de `storage/{session,message,part}/*.json` a una base SQLite
// (`opencode.db`, tablas session/message/part). El lector de ficheros seguía buscando el layout
// viejo, no encontraba nada y la captura se iba en silencio: OpenCode parecía configurado y no
// guardaba una sola sesión. Se soportan los dos, empezando por la base, porque un portátil con
// OpenCode antiguo conserva el store de ficheros.

/** Una sesión de OpenCode por id (lo que da el hook). */
export async function readOpenCodeSession(sessionId: string): Promise<RawSession | null> {
  if (!sessionId) return null;
  return (await collectOpenCode(null, sessionId))[0] ?? null;
}

export async function readOpenCodeSessions(repoPath: string): Promise<RawSession[]> {
  return collectOpenCode(resolve(repoPath), null);
}

function openCodeRoot(): string {
  return process.env.CORTEX_OPENCODE_DIR || join(homedir(), ".local/share/opencode/storage");
}

/** La base vive un nivel por encima del store de ficheros (…/opencode/opencode.db). */
function openCodeDbPath(): string {
  return process.env.CORTEX_OPENCODE_DB || join(openCodeRoot(), "..", "opencode.db");
}

async function collectOpenCode(target: string | null, wantedId: string | null): Promise<RawSession[]> {
  const desdeDb = await collectOpenCodeDb(target, wantedId);
  if (desdeDb.length > 0) return desdeDb;
  return collectOpenCodeFiles(target, wantedId);
}

/** Formato actual: SQLite. `part.data` es JSON; solo interesa `{type:"text", text}`. */
async function collectOpenCodeDb(target: string | null, wantedId: string | null): Promise<RawSession[]> {
  const dbPath = openCodeDbPath();
  if (!existsSync(dbPath)) return [];
  const sqlite = await cargaSqlite();
  if (!sqlite) return []; // Node < 22.5: se intentará el store de ficheros
  const { DatabaseSync } = sqlite;
  const out: RawSession[] = [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const sesiones = db
      .prepare("SELECT id, directory, parent_id FROM session ORDER BY time_created ASC")
      .all() as { id: string; directory?: string; parent_id?: string | null }[];
    const stmtMsgs = db.prepare("SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC");
    const stmtParts = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC");

    for (const s of sesiones) {
      if (s.parent_id) continue; // subagentes: su diálogo ya viaja en el de la sesión padre
      if (wantedId && s.id !== wantedId) continue;
      if (target && s.directory && resolve(s.directory) !== target) continue;

      const msgs: { role: string; text: string }[] = [];
      for (const m of stmtMsgs.all(s.id) as { id: string; data: string }[]) {
        const meta = safe(() => JSON.parse(m.data) as { role?: string }, null);
        if (!meta?.role) continue;
        const text = (stmtParts.all(m.id) as { data: string }[])
          .map((p) => safe(() => JSON.parse(p.data) as { type?: string; text?: string; synthetic?: boolean; ignored?: boolean }, null))
          .filter((p) => p && p.type === "text" && p.text && !p.synthetic && !p.ignored)
          .map((p) => p!.text as string)
          .join("\n");
        if (text) msgs.push({ role: meta.role, text });
      }
      const condensed = condenseMessages(msgs);
      if (condensed) out.push({ sessionId: s.id, condensed });
    }
    db.close();
  } catch {
    return []; // base bloqueada o con otro esquema: que lo intente el store de ficheros
  }
  return out;
}

/** Formato antiguo: un fichero JSON por sesión, mensaje y parte. */
function collectOpenCodeFiles(target: string | null, wantedId: string | null): RawSession[] {
  const base = openCodeRoot();
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
      if (wantedId && info.id !== wantedId) continue;
      if (target && info.directory && resolve(info.directory) !== target) continue;
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
/** Una sesión de Hermes por id. */
export async function readHermesSession(sessionId: string): Promise<RawSession | null> {
  if (!sessionId) return null;
  const all = await collectHermes(null, sessionId);
  return all[0] ?? null;
}

export async function readHermesSessions(repoPath: string): Promise<RawSession[]> {
  return collectHermes(resolve(repoPath), null);
}

async function collectHermes(target: string | null, wantedId: string | null): Promise<RawSession[]> {
  const dbPath = process.env.CORTEX_HERMES_DB || join(homedir(), ".hermes", "state.db");
  if (!existsSync(dbPath)) return [];
  const sqlite = await cargaSqlite();
  if (!sqlite) {
    console.error("  (node:sqlite no disponible; Hermes requiere Node ≥ 22)");
    return [];
  }
  const { DatabaseSync } = sqlite;
  const out: RawSession[] = [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    // sessions.cwd puede no existir; filtramos por cwd si está, si no, todas.
    const cols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
    const hasCwd = cols.includes("cwd");
    const sessRows = (hasCwd ? db.prepare("SELECT id, cwd FROM sessions").all() : db.prepare("SELECT id FROM sessions").all()) as { id: string; cwd?: string }[];
    const stmt = db.prepare("SELECT role, content FROM messages WHERE session_id = ? ORDER BY rowid ASC");
    for (const s of sessRows) {
      if (wantedId && s.id !== wantedId) continue;
      if (target && hasCwd && s.cwd && resolve(s.cwd) !== target) continue;
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

// --- Pi: ~/.pi/agent/sessions/<carpeta por cwd>/<ts>_<uuid>.jsonl ------------
function piRoot(): string {
  return process.env.CORTEX_PI_DIR || join(homedir(), ".pi", "agent", "sessions");
}

/**
 * Lee una sesión de Pi. El fichero empieza por una línea `{"type":"session", cwd, id}` y
 * sigue con `{"type":"message", message:{role, content:[{type:"text", text}]}}`.
 *
 * El nombre de la carpeta sale de sanear el cwd (las barras pasan a guiones), lo que hace
 * imposible deshacerlo sin ambigüedad: por eso el repo se comprueba leyendo el `cwd` de
 * dentro del fichero y no adivinándolo desde la ruta.
 */
export function readPiSession(filePath: string): (RawSession & { cwd: string }) | null {
  if (!existsSync(filePath)) return null;
  const lines = safe(() => readFileSync(filePath, "utf8").split("\n").filter(Boolean), [] as string[]);
  let cwd = "";
  let id = "";
  const msgs: { role: string; text: string }[] = [];
  for (const line of lines) {
    const row = safe(() => JSON.parse(line) as { type?: string; cwd?: string; id?: string; message?: any }, null);
    if (!row) continue;
    if (row.type === "session") {
      cwd = row.cwd ?? cwd;
      id = row.id ?? id;
      continue;
    }
    if (row.type !== "message" || !row.message) continue;
    const role = row.message.role as string;
    const text = Array.isArray(row.message.content)
      ? row.message.content.filter((c: any) => c?.type === "text" && typeof c.text === "string").map((c: any) => c.text).join("\n")
      : typeof row.message.content === "string"
        ? row.message.content
        : "";
    if (text) msgs.push({ role, text });
  }
  const condensed = condenseMessages(msgs);
  if (!condensed) return null;
  return { sessionId: id || basename(filePath).replace(/\.jsonl$/, ""), condensed, cwd };
}

/** Todas las sesiones de Pi de un repo. */
export function readPiSessions(repoPath: string): RawSession[] {
  const root = piRoot();
  if (!existsSync(root)) return [];
  const target = resolve(repoPath);
  const out: RawSession[] = [];
  for (const dir of safe(() => readdirSync(root), [] as string[])) {
    const full = join(root, dir);
    if (!safe(() => statSync(full).isDirectory(), false)) continue;
    for (const f of safe(() => readdirSync(full).filter((x) => x.endsWith(".jsonl")), [] as string[])) {
      const s = readPiSession(join(full, f));
      if (!s || resolve(s.cwd || "") !== target) continue;
      out.push({ sessionId: s.sessionId, condensed: s.condensed });
    }
  }
  return out;
}

export type CaptureAgent = "claude" | "codex" | "opencode" | "hermes" | "pi";

/**
 * Una sola sesión, sea cual sea el agente. `ref` es lo que tenga a mano el hook: una ruta de
 * fichero (Claude, Pi, Codex) o un id de sesión (OpenCode, Hermes, Codex). Devuelve `null`
 * si no se encuentra, y quien llama decide si eso merece un aviso o silencio.
 */
export async function readSessionByRef(platform: CaptureAgent, ref: string): Promise<RawSession | null> {
  if (!ref) return null;
  switch (platform) {
    case "codex":
      return readCodexSession(ref);
    case "opencode":
      return readOpenCodeSession(ref);
    case "hermes":
      return readHermesSession(ref);
    case "pi": {
      const s = readPiSession(ref);
      return s ? { sessionId: s.sessionId, condensed: s.condensed } : null;
    }
    default:
      return null; // claude va por `condenseSession(transcript_path)`, que conserva más señal
  }
}

export async function readSessions(platform: string, repoPath: string): Promise<RawSession[]> {
  if (platform === "codex") return readCodexSessions(repoPath);
  if (platform === "opencode") return readOpenCodeSessions(repoPath);
  if (platform === "hermes") return readHermesSessions(repoPath);
  if (platform === "pi") return readPiSessions(repoPath);
  return [];
}
