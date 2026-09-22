import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findCodexRollout,
  latestCodexRollout,
  readCodexSession,
  readCodexSessions,
  readHermesSessions,
  readOpenCodeSession,
  readOpenCodeSessions,
  readPiSession,
  readPiSessions,
  readSessionByRef,
} from "../packages/client/src/session-readers";

const REPO = "/tmp/fake-repo-cortex";
const tmps: string[] = [];
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.CORTEX_CODEX_DIR;
  delete process.env.CORTEX_OPENCODE_DIR;
  delete process.env.CORTEX_HERMES_DB;
  delete process.env.CORTEX_PI_DIR;
});

describe("readCodexSessions (~/.codex/sessions/*.jsonl)", () => {
  it("extracts user+assistant from the repo and skips tool calls", () => {
    const dir = tmp("codex-");
    const day = join(dir, "2026/06/24");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-x-uuid.jsonl"),
      [
        JSON.stringify({ type: "session_meta", payload: { cwd: REPO } }),
        JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Como configuro pgvector?" }] } }),
        JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1" } }),
        JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Usa pgvector pg16 en docker-compose." }] } }),
      ].join("\n"),
    );
    process.env.CORTEX_CODEX_DIR = dir;
    const sessions = readCodexSessions(REPO);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.condensed).toContain("[user] Como configuro pgvector?");
    expect(sessions[0]!.condensed).toContain("[assistant] Usa pgvector");
    expect(sessions[0]!.condensed).not.toContain("exec_command");
  });

  it("ignores sessions from another repo (a different cwd)", () => {
    const dir = tmp("codex-");
    const day = join(dir, "2026/06/24");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-y.jsonl"),
      [
        JSON.stringify({ type: "session_meta", payload: { cwd: "/otro/repo" } }),
        JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi, how is everything going" }] } }),
      ].join("\n"),
    );
    process.env.CORTEX_CODEX_DIR = dir;
    expect(readCodexSessions(REPO)).toHaveLength(0);
  });
});

describe("readOpenCodeSessions (the old file store)", () => {
  it("joins text parts and leaves out tool/subagent parts", async () => {
    const base = tmp("oc-");
    mkdirSync(join(base, "session/proj1"), { recursive: true });
    mkdirSync(join(base, "message/ses1"), { recursive: true });
    mkdirSync(join(base, "part/m1"), { recursive: true });
    mkdirSync(join(base, "part/m2"), { recursive: true });
    writeFileSync(join(base, "session/proj1/ses1.json"), JSON.stringify({ id: "ses1", directory: REPO }));
    writeFileSync(join(base, "message/ses1/m1.json"), JSON.stringify({ id: "m1", role: "user" }));
    writeFileSync(join(base, "message/ses1/m2.json"), JSON.stringify({ id: "m2", role: "assistant" }));
    writeFileSync(join(base, "part/m1/p1.json"), JSON.stringify({ type: "text", text: "How do I add an endpoint?" }));
    writeFileSync(join(base, "part/m2/p1.json"), JSON.stringify({ type: "tool", tool: "bash" }));
    writeFileSync(join(base, "part/m2/p2.json"), JSON.stringify({ type: "text", text: "Add the route in apps/server." }));
    process.env.CORTEX_OPENCODE_DIR = base;
    process.env.CORTEX_OPENCODE_DB = join(base, "no-database-here.db"); // force the file path
    const sessions = await readOpenCodeSessions(REPO);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.condensed).toContain("[user] How do I add an endpoint?");
    expect(sessions[0]!.condensed).toContain("[assistant] Add the route");
    expect(sessions[0]!.condensed).not.toContain("bash");
  });
});

describe("readHermesSessions (SQLite)", () => {
  it("degrades gracefully when there is no state.db", async () => {
    process.env.CORTEX_HERMES_DB = "/tmp/does-not-exist-cortex.db";
    expect(await readHermesSessions(REPO)).toEqual([]);
  });
});

function codexRollout(cwd = REPO): string {
  const dir = tmp("codex-one-");
  const day = join(dir, "2026/09/10");
  mkdirSync(day, { recursive: true });
  const file = join(day, "rollout-2026-09-10T10-00-00-abc123-def.jsonl");
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "session_meta", payload: { cwd } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "why Caddy and not nginx?" }] } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "because of the automatic TLS" }] } }),
    ].join("\n"),
  );
  process.env.CORTEX_CODEX_DIR = dir;
  return file;
}

describe("a single Codex session (what the hook needs)", () => {
  it("finds the rollout by id, even buried under year/month/day", () => {
    const file = codexRollout();
    expect(findCodexRollout("abc123-def")).toBe(file);
    expect(findCodexRollout("does-not-exist")).toBeNull();
  });

  it("reads the session by path or by id, either way", () => {
    const file = codexRollout();
    for (const ref of [file, "abc123-def"]) {
      const s = readCodexSession(ref)!;
      expect(s.condensed).toContain("Caddy");
      expect(s.condensed).toContain("TLS");
    }
  });

  it("as a last resort, THIS repo's most recent rollout", () => {
    const file = codexRollout();
    expect(latestCodexRollout(REPO)).toBe(file);
    expect(latestCodexRollout("/otro/repo")).toBeNull();
  });
});

describe("readPiSession / readPiSessions", () => {
  function piSession(cwd = REPO): { dir: string; file: string } {
    const dir = tmp("pi-");
    const sub = join(dir, "--tmp-fake-repo-cortex--");
    mkdirSync(sub, { recursive: true });
    const file = join(sub, "2026-09-10T10-00-00-000Z_01a0-uuid.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "session", version: 3, id: "01a0-uuid", cwd }),
        JSON.stringify({ type: "model_change", provider: "nan", modelId: "glm5.3-flash" }),
        JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "where do we keep the backups?" }] } }),
        JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "on a separate volume, 7d retention" }] } }),
      ].join("\n"),
    );
    process.env.CORTEX_PI_DIR = dir;
    return { dir, file };
  }

  it("takes the dialogue and the id from inside the file", () => {
    const { file } = piSession();
    const s = readPiSession(file)!;
    expect(s.sessionId).toBe("01a0-uuid");
    expect(s.cwd).toBe(REPO);
    expect(s.condensed).toContain("backups");
    expect(s.condensed).toContain("7d retention");
    expect(s.condensed).not.toContain("glm5.3-flash"); // model switches are not dialogue
  });

  it("filters by the cwd inside, not by the folder's name", () => {
    // Pi's folder name comes from sanitising the cwd and cannot be undone unambiguously.
    piSession("/another/project");
    expect(readPiSessions(REPO)).toHaveLength(0);
  });

  it("lists the repo's sessions", () => {
    piSession();
    const all = readPiSessions(REPO);
    expect(all).toHaveLength(1);
    expect(all[0]!.sessionId).toBe("01a0-uuid");
  });

  it("a file that does not exist does not blow up", () => {
    expect(readPiSession("/no/existe.jsonl")).toBeNull();
  });
});

describe("readSessionByRef", () => {
  it("dispatches to each agent's reader", async () => {
    const file = codexRollout();
    expect((await readSessionByRef("codex", file))!.condensed).toContain("Caddy");
    expect(await readSessionByRef("codex", "nada")).toBeNull();
    expect(await readSessionByRef("pi", "/no/existe.jsonl")).toBeNull();
    // Claude does not come through here: its transcript is read with condenseSession, which keeps more.
    expect(await readSessionByRef("claude", "/whatever")).toBeNull();
  });
});

/**
 * OpenCode moved sessions from JSON files to SQLite. The reader kept looking for the old
 * layout, found nothing, and capture failed silently: it looked configured and stored not a
 * single session. Here a database with the real schema is built and it is checked that it
 * gets read.
 */
describe("readOpenCodeSessions (SQLite, the current format)", () => {
  it("reads sessions from opencode.db and prefers the database to the file store", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const base = tmp("oc-db-");
    mkdirSync(base, { recursive: true });
    const dbPath = join(base, "opencode.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE session (id text PRIMARY KEY, project_id text, parent_id text, directory text, time_created integer);
             CREATE TABLE message (id text PRIMARY KEY, session_id text, time_created integer, data text);
             CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, data text);`);
    const ses = (id: string, dir: string, parent: string | null, t: number): void => {
      db.prepare("INSERT INTO session VALUES (?,?,?,?,?)").run(id, "prj", parent, dir, t);
    };
    const msg = (id: string, sid: string, role: string, t: number): void => {
      db.prepare("INSERT INTO message VALUES (?,?,?,?)").run(id, sid, t, JSON.stringify({ role }));
    };
    const part = (id: string, mid: string, sid: string, data: unknown, t: number): void => {
      db.prepare("INSERT INTO part VALUES (?,?,?,?,?)").run(id, mid, sid, t, JSON.stringify(data));
    };

    ses("ses1", REPO, null, 1);
    msg("m1", "ses1", "user", 1);
    part("p1", "m1", "ses1", { type: "text", text: "Which backoff do we use?" }, 1);
    msg("m2", "ses1", "assistant", 2);
    part("p2", "m2", "ses1", { type: "reasoning", text: "thinking out loud" }, 1);
    part("p3", "m2", "ses1", { type: "text", text: "Exponential, capped at 60s." }, 2);
    ses("ses-sub", REPO, "ses1", 3); // a sub-agent: it must not come out on its own
    ses("ses-other", "/other/repo", null, 4);
    msg("m3", "ses-other", "user", 4);
    part("p4", "m3", "ses-other", { type: "text", text: "This belongs to another repository." }, 4);

    db.close();

    process.env.CORTEX_OPENCODE_DIR = join(base, "storage");
    process.env.CORTEX_OPENCODE_DB = dbPath;

    const sessions = await readOpenCodeSessions(REPO);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe("ses1");
    expect(sessions[0]!.condensed).toContain("[user] Which backoff do we use?");
    expect(sessions[0]!.condensed).toContain("[assistant] Exponential, capped at 60s.");
    expect(sessions[0]!.condensed).not.toContain("thinking out loud");

    expect((await readOpenCodeSession("ses1"))!.condensed).toContain("backoff");
    expect(await readOpenCodeSession("ses-other")).not.toBeNull(); // by id there is no repo filter
    expect(await readOpenCodeSession("does-not-exist")).toBeNull();
  });
});

describe("readOpenCodeSession (by id)", () => {
  it("returns only the session asked for", async () => {
    const base = tmp("oc-one-");
    process.env.CORTEX_OPENCODE_DIR = base;
    process.env.CORTEX_OPENCODE_DB = join(base, "no-database-here.db");
    const mk = (sid: string, text: string): void => {
      mkdirSync(join(base, "session/prj"), { recursive: true });
      writeFileSync(join(base, `session/prj/${sid}.json`), JSON.stringify({ id: sid, directory: REPO }));
      mkdirSync(join(base, `message/${sid}`), { recursive: true });
      writeFileSync(join(base, `message/${sid}/m1.json`), JSON.stringify({ id: `${sid}-m1`, role: "user" }));
      mkdirSync(join(base, `part/${sid}-m1`), { recursive: true });
      writeFileSync(join(base, `part/${sid}-m1/p1.json`), JSON.stringify({ type: "text", text }));
    };
    mk("ses-a", "we talked about the capture queue");
    mk("ses-b", "we talked about something else");
    expect((await readOpenCodeSession("ses-a"))!.condensed).toContain("capture queue");
    expect((await readOpenCodeSession("ses-b"))!.condensed).toContain("something else");
    expect(await readOpenCodeSession("does-not-exist")).toBeNull();
    expect(await readOpenCodeSessions(REPO)).toHaveLength(2);
  });
});

describe("which agent called the hook", () => {
  it("is derived from the transcript's path, because the plugin is shared by several", async () => {
    const { detectPlatform } = await import("../apps/cli/src/commands/hook-capture.js");
    expect(detectPlatform("/Users/x/.codex/sessions/2026/09/10/rollout-a.jsonl")).toBe("codex");
    expect(detectPlatform("/Users/x/.pi/agent/sessions/--x--/a.jsonl")).toBe("pi");
    expect(detectPlatform("/Users/x/.claude/projects/-Users-x-repo/a.jsonl")).toBe("claude");
    expect(detectPlatform(undefined)).toBe("claude");
  });
});
