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
  it("extrae user+assistant del repo y omite tool calls", () => {
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
    expect(sessions[0]!.condensed).not.toContain("exec_command"); // tool call omitida
  });

  it("ignora sesiones de otro repo (cwd distinto)", () => {
    const dir = tmp("codex-");
    const day = join(dir, "2026/06/24");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-y.jsonl"),
      [
        JSON.stringify({ type: "session_meta", payload: { cwd: "/otro/repo" } }),
        JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hola que tal todo bien por aqui" }] } }),
      ].join("\n"),
    );
    process.env.CORTEX_CODEX_DIR = dir;
    expect(readCodexSessions(REPO)).toHaveLength(0);
  });
});

describe("readOpenCodeSessions (storage: session→message→part)", () => {
  it("une partes de texto y omite partes tool/subagentes", () => {
    const base = tmp("oc-");
    mkdirSync(join(base, "session/proj1"), { recursive: true });
    mkdirSync(join(base, "message/ses1"), { recursive: true });
    mkdirSync(join(base, "part/m1"), { recursive: true });
    mkdirSync(join(base, "part/m2"), { recursive: true });
    writeFileSync(join(base, "session/proj1/ses1.json"), JSON.stringify({ id: "ses1", directory: REPO }));
    writeFileSync(join(base, "message/ses1/m1.json"), JSON.stringify({ id: "m1", role: "user" }));
    writeFileSync(join(base, "message/ses1/m2.json"), JSON.stringify({ id: "m2", role: "assistant" }));
    writeFileSync(join(base, "part/m1/p1.json"), JSON.stringify({ type: "text", text: "Como añado un endpoint?" }));
    writeFileSync(join(base, "part/m2/p1.json"), JSON.stringify({ type: "tool", tool: "bash" }));
    writeFileSync(join(base, "part/m2/p2.json"), JSON.stringify({ type: "text", text: "Añade la ruta en apps/server." }));
    process.env.CORTEX_OPENCODE_DIR = base;
    const sessions = readOpenCodeSessions(REPO);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.condensed).toContain("[user] Como añado un endpoint?");
    expect(sessions[0]!.condensed).toContain("[assistant] Añade la ruta");
    expect(sessions[0]!.condensed).not.toContain("bash"); // parte tool omitida
  });
});

describe("readHermesSessions (SQLite)", () => {
  it("degrada con elegancia si no hay state.db", async () => {
    process.env.CORTEX_HERMES_DB = "/tmp/no-existe-cortex.db";
    expect(await readHermesSessions(REPO)).toEqual([]);
  });
});

/** Un rollout de Codex con dos turnos, en la estructura de carpetas que usa el agente. */
function codexRollout(cwd = REPO): string {
  const dir = tmp("codex-one-");
  const day = join(dir, "2026/09/10");
  mkdirSync(day, { recursive: true });
  const file = join(day, "rollout-2026-09-10T10-00-00-abc123-def.jsonl");
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "session_meta", payload: { cwd } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "por que Caddy y no nginx?" }] } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "por el TLS automatico" }] } }),
    ].join("\n"),
  );
  process.env.CORTEX_CODEX_DIR = dir;
  return file;
}

describe("una sola sesión de Codex (lo que necesita el hook)", () => {
  it("encuentra el rollout por id, aunque esté enterrado en año/mes/día", () => {
    const file = codexRollout();
    expect(findCodexRollout("abc123-def")).toBe(file);
    expect(findCodexRollout("no-existe")).toBeNull();
  });

  it("lee la sesión por ruta o por id, indistintamente", () => {
    const file = codexRollout();
    for (const ref of [file, "abc123-def"]) {
      const s = readCodexSession(ref)!;
      expect(s.condensed).toContain("Caddy");
      expect(s.condensed).toContain("TLS");
    }
  });

  it("como último recurso, el rollout más reciente de ESTE repo", () => {
    const file = codexRollout();
    expect(latestCodexRollout(REPO)).toBe(file);
    expect(latestCodexRollout("/otro/repo")).toBeNull();
  });
});

describe("readPiSession / readPiSessions", () => {
  /** El formato de Pi: una línea `session` con el cwd y luego mensajes con content[]. */
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
        JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "donde guardamos los backups?" }] } }),
        JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "en un volumen aparte, retencion 7d" }] } }),
      ].join("\n"),
    );
    process.env.CORTEX_PI_DIR = dir;
    return { dir, file };
  }

  it("saca el diálogo y el id de dentro del fichero", () => {
    const { file } = piSession();
    const s = readPiSession(file)!;
    expect(s.sessionId).toBe("01a0-uuid");
    expect(s.cwd).toBe(REPO);
    expect(s.condensed).toContain("backups");
    expect(s.condensed).toContain("retencion 7d");
    expect(s.condensed).not.toContain("glm5.3-flash"); // los cambios de modelo no son diálogo
  });

  it("filtra por el cwd de dentro, no por el nombre de la carpeta", () => {
    // El nombre de carpeta de Pi sale de sanear el cwd y no se puede deshacer sin ambigüedad.
    piSession("/otro/proyecto");
    expect(readPiSessions(REPO)).toHaveLength(0);
  });

  it("lista las sesiones del repo", () => {
    piSession();
    const all = readPiSessions(REPO);
    expect(all).toHaveLength(1);
    expect(all[0]!.sessionId).toBe("01a0-uuid");
  });

  it("un fichero que no existe no revienta", () => {
    expect(readPiSession("/no/existe.jsonl")).toBeNull();
  });
});

describe("readSessionByRef", () => {
  it("despacha al lector de cada agente", async () => {
    const file = codexRollout();
    expect((await readSessionByRef("codex", file))!.condensed).toContain("Caddy");
    expect(await readSessionByRef("codex", "nada")).toBeNull();
    expect(await readSessionByRef("pi", "/no/existe.jsonl")).toBeNull();
    // Claude no pasa por aquí: su transcript se lee con condenseSession, que conserva más.
    expect(await readSessionByRef("claude", "/lo/que/sea")).toBeNull();
  });
});

describe("readOpenCodeSession (por id)", () => {
  it("devuelve solo la sesión pedida", () => {
    const base = tmp("oc-one-");
    process.env.CORTEX_OPENCODE_DIR = base;
    const mk = (sid: string, texto: string): void => {
      mkdirSync(join(base, "session/prj"), { recursive: true });
      writeFileSync(join(base, `session/prj/${sid}.json`), JSON.stringify({ id: sid, directory: REPO }));
      mkdirSync(join(base, `message/${sid}`), { recursive: true });
      writeFileSync(join(base, `message/${sid}/m1.json`), JSON.stringify({ id: `${sid}-m1`, role: "user" }));
      mkdirSync(join(base, `part/${sid}-m1`), { recursive: true });
      writeFileSync(join(base, `part/${sid}-m1/p1.json`), JSON.stringify({ type: "text", text: texto }));
    };
    mk("ses-a", "hablamos de la cola de captura");
    mk("ses-b", "hablamos de otra cosa");
    expect(readOpenCodeSession("ses-a")!.condensed).toContain("cola de captura");
    expect(readOpenCodeSession("ses-b")!.condensed).toContain("otra cosa");
    expect(readOpenCodeSession("no-existe")).toBeNull();
    expect(readOpenCodeSessions(REPO)).toHaveLength(2);
  });
});

describe("qué agente ha llamado al hook", () => {
  it("se deduce de la ruta del transcript, porque el plugin es el mismo para varios", async () => {
    const { detectPlatform } = await import("../apps/cli/src/commands/hook-capture.js");
    expect(detectPlatform("/Users/x/.codex/sessions/2026/09/10/rollout-a.jsonl")).toBe("codex");
    expect(detectPlatform("/Users/x/.pi/agent/sessions/--x--/a.jsonl")).toBe("pi");
    expect(detectPlatform("/Users/x/.claude/projects/-Users-x-repo/a.jsonl")).toBe("claude");
    expect(detectPlatform(undefined)).toBe("claude");
  });
});
