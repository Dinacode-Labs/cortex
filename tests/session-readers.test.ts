import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexSessions, readOpenCodeSessions, readHermesSessions } from "../packages/client/src/session-readers";

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
