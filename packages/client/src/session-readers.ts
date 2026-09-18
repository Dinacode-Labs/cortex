import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/**
 * Readers for each agent's session STORE. Every agent stores its conversations its own way --
 * JSONL per session, loose files per message, SQLite -- and here they are all translated into
 * the same thing: `{ sessionId, condensed }` with the useful dialogue, no tool calls and no
 * dumps.
 *
 * They are used in two places: the backfill (`connect-sessions`, which wants ALL of a repo's
 * sessions) and the capture hook (which wants ONE, the session that just ended). Hence the two
 * variants per agent.
 *
 * Defensive by design: when the store does not exist, changes format or is half-written, they
 * return empty instead of throwing. A hook must not break anybody's session.
 * See docs/research/hooks-integration.md.
 */
export interface RawSession {
  sessionId: string;
  condensed: string;
}

const MAX_MSG = 2000;
const MAX_TOTAL = 60_000;

/** Joins {role,text} messages into a readable transcript (capped per message and overall). */
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

/** Reads a Codex rollout. It also returns the `cwd` so results can be filtered by repo. */
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
 * Locates a session's rollout. Codex names the files `rollout-<date>-<uuid>.jsonl` and spreads
 * them across year/month/day, so the id the hook hands over is not enough to build the path:
 * it has to be searched for.
 */
export function findCodexRollout(sessionId: string): string | null {
  if (!sessionId) return null;
  const files = walkJsonl(codexRoot());
  const hit = files.find((f) => basename(f).includes(sessionId));
  if (hit) return hit;
  return null;
}

/** A repo's most recent rollout: the fallback when the hook gives no session id. */
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

/** One Codex session, by rollout path or by id. */
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
    if (!s || resolve(s.cwd || "") !== target) continue; // only sessions from this repo
    sessions.push({ sessionId: s.sessionId, condensed: s.condensed });
  }
  return sessions;
}

/**
 * Loads `node:sqlite` in a way the bundler cannot touch the module name.
 *
 * With the literal specifier, esbuild (through tsup) rewrote `import("node:sqlite")` as
 * `import("sqlite")` -- dropping the prefix -- when bundling the CLI. That module does not
 * exist, the import threw, the `catch` returned empty and OpenCode and Hermes capture failed
 * silently: it worked from source and did not work from npm, which is the worst way for
 * something to be broken. Splitting the string prevents the rewrite, because the bundler no
 * longer sees a constant. There is a test covering the bundle (`tests/cli-smoke.test.ts`).
 */
async function loadSqlite(): Promise<any | null> {
  const specifier = "node:" + "sqlite";
  try {
    return await import(/* @vite-ignore */ specifier);
  } catch {
    return null; // Node < 22.5
  }
}

// --- OpenCode: SQLite (opencode.db) and, failing that, the old file store -----
//
// OpenCode moved sessions from `storage/{session,message,part}/*.json` into a SQLite database
// (`opencode.db`, tables session/message/part). The file reader kept looking for the old
// layout, found nothing, and capture failed silently: OpenCode looked configured and stored not
// a single session. Both are supported, database first, because a laptop with an older
// OpenCode still has the file store.

/** One OpenCode session by id (what the hook provides). */
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

/** The database lives one level above the file store (.../opencode/opencode.db). */
function openCodeDbPath(): string {
  return process.env.CORTEX_OPENCODE_DB || join(openCodeRoot(), "..", "opencode.db");
}

async function collectOpenCode(target: string | null, wantedId: string | null): Promise<RawSession[]> {
  const fromDb = await collectOpenCodeDb(target, wantedId);
  if (fromDb.length > 0) return fromDb;
  return collectOpenCodeFiles(target, wantedId);
}

/** Current format: SQLite. `part.data` is JSON; only `{type:"text", text}` matters. */
async function collectOpenCodeDb(target: string | null, wantedId: string | null): Promise<RawSession[]> {
  const dbPath = openCodeDbPath();
  if (!existsSync(dbPath)) return [];
  const sqlite = await loadSqlite();
  if (!sqlite) return []; // Node < 22.5: the file store will be tried instead
  const { DatabaseSync } = sqlite;
  const out: RawSession[] = [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const sessions = db
      .prepare("SELECT id, directory, parent_id FROM session ORDER BY time_created ASC")
      .all() as { id: string; directory?: string; parent_id?: string | null }[];
    const stmtMsgs = db.prepare("SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC");
    const stmtParts = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC");

    for (const s of sessions) {
      if (s.parent_id) continue; // sub-agents: their dialogue already travels in the parent's
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
    return []; // database locked or with a different schema: let the file store try
  }
  return out;
}

/** Old format: one JSON file per session, message and part. */
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
      if (!info?.id || info.parentID) continue; // skip sub-agents
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
/** One Hermes session by id. */
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
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.error("  (node:sqlite unavailable; Hermes needs Node >= 22)");
    return [];
  }
  const { DatabaseSync } = sqlite;
  const out: RawSession[] = [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    // sessions.cwd may not exist; filter by cwd when present, otherwise take them all.
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
    console.error(`  (could not read ${dbPath}: ${(e as Error).message})`);
  }
  return out;
}

// --- Pi: ~/.pi/agent/sessions/<folder per cwd>/<ts>_<uuid>.jsonl -------------
function piRoot(): string {
  return process.env.CORTEX_PI_DIR || join(homedir(), ".pi", "agent", "sessions");
}

/**
 * Reads a Pi session. The file starts with a `{"type":"session", cwd, id}` line and continues
 * with `{"type":"message", message:{role, content:[{type:"text", text}]}}`.
 *
 * The folder name comes from sanitising the cwd (slashes become hyphens), which makes it
 * impossible to undo unambiguously: that is why the repo is checked by reading the `cwd` from
 * inside the file rather than guessing it from the path.
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

/** Every Pi session belonging to a repo. */
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
 * A single session, whichever the agent. `ref` is whatever the hook has at hand: a file path
 * (Claude, Pi, Codex) or a session id (OpenCode, Hermes, Codex). It returns `null` when
 * nothing is found, and the caller decides whether that deserves a warning or silence.
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
      return null; // claude goes through `condenseSession(transcript_path)`, which keeps more signal
  }
}

export async function readSessions(platform: string, repoPath: string): Promise<RawSession[]> {
  if (platform === "codex") return readCodexSessions(repoPath);
  if (platform === "opencode") return readOpenCodeSessions(repoPath);
  if (platform === "hermes") return readHermesSessions(repoPath);
  if (platform === "pi") return readPiSessions(repoPath);
  return [];
}
