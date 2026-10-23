import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeSql, getSql } from "@cortex/database";
import { createProject, requestOtp, uncheckedCount, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp } from "../../apps/server/src/app.js";
import { memoryUpload, readClaudeMemory } from "../../packages/client/src/claude-memory.js";

/**
 * What `cortex connect-memory` sends has to land as ADR-0095 says: low, from Claude Code, with the
 * note's description as its summary, its links as relations, and waiting for a person in Review.
 * The `summary` field is new in `/capture/batch`, and a route schema that forgets it drops it
 * without a word.
 */

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `memory-owner-${RID}@example.com`;
const app = createApp();

async function tokenFor(email: string): Promise<string> {
  let cap = "";
  const orig = console.log;
  console.log = ((...a: unknown[]) => {
    cap += a.join(" ") + "\n";
  }) as typeof console.log;
  try {
    await requestOtp(email);
  } finally {
    console.log = orig;
  }
  const code = cap.split("\n").find((l) => l.includes(email))?.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`the OTP for ${email} was not captured`);
  return (await verifyOtp(email, code)).token;
}

let token: string;
let dir: string;

beforeAll(async () => {
  token = await tokenFor(OWNER);
  dir = mkdtempSync(join(tmpdir(), "cortex-connect-memory-"));
}, 120_000);

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closeSql();
});

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function writeNotes(deployBody: string): void {
  writeFileSync(
    join(dir, "MEMORY.md"),
    "- [Tests run before a merge](conv.md) — always\n- [Releases ship from main](deploy.md) — tags\n",
  );
  writeFileSync(
    join(dir, "conv.md"),
    `---\nname: conv\ndescription: The suites run before anything merges ${RID}\nmetadata:\n  type: feedback\n---\n\nRun both suites first. See [[deploy]].\n`,
  );
  writeFileSync(
    join(dir, "deploy.md"),
    `---\nname: deploy\ndescription: How a release ships ${RID}\nmetadata:\n  type: project\n---\n\n${deployBody}\n`,
  );
}

async function send(project: ProjectRef): Promise<{ added: number; existing: number; idOf: Map<string, string> }> {
  const upload = memoryUpload(readClaudeMemory(dir));
  const res = await post("/capture/batch", { slug: project.slug, items: upload.items });
  expect(res.status).toBe(200);
  const { results } = (await res.json()) as { results: { ref: string; id: string; action: string }[] };
  const idOf = new Map(results.map((r) => [r.ref, r.id]));
  for (const { from, to } of upload.links) {
    expect((await post("/relate", { sourceId: idOf.get(from), targetId: idOf.get(to), relationType: "related_to" })).status).toBe(200);
  }
  const added = results.filter((r) => r.action === "added").length;
  return { added, existing: results.length - added, idOf };
}

describe("Claude Code's memory through the API", () => {
  it("lands low, from Claude Code, summarised by its description, linked, and waiting for a person", async () => {
    const project = await createProject(`IT Memory ${RID}`, { visibility: "private", ownerEmail: OWNER });
    writeNotes(`Releases are tagged from main ${RID}.`);
    const { added, idOf } = await send(project);
    expect(added).toBe(2);

    const rows = await getSql()<{ id: string; title: string; type: string; confidence: string; source_type: string; summary: string }[]>`
      SELECT id, title, type, confidence, source_type, summary FROM memos WHERE id = ANY(${[...idOf.values()]}) ORDER BY title`;
    expect(rows.map((r) => [r.title, r.confidence, r.source_type, r.summary])).toEqual([
      ["Releases ship from main", "low", "claude_code", `How a release ships ${RID}`],
      ["Tests run before a merge", "low", "claude_code", `The suites run before anything merges ${RID}`],
    ]);
    expect(rows.find((r) => r.title === "Tests run before a merge")!.type).toBe("convention");

    const [conv, deploy] = [rows[1]!.id, rows[0]!.id];
    const relations = await getSql()`
      SELECT 1 FROM relations WHERE source_id = ${conv} AND target_id = ${deploy} AND relation_type = 'related_to' AND valid_to IS NULL`;
    expect(relations).toHaveLength(1);
    expect(await uncheckedCount(project)).toBe(2);
  });

  it("adds nothing the second time, and a note that changed comes in again", async () => {
    const project = await createProject(`IT Memory Rerun ${RID}`, { visibility: "private", ownerEmail: OWNER });
    writeNotes(`Releases are tagged from main ${RID}.`);
    await send(project);

    expect(await send(project)).toMatchObject({ added: 0, existing: 2 });

    writeNotes(`Releases are tagged from main, and only by the release workflow ${RID}.`);
    expect(await send(project)).toMatchObject({ added: 1, existing: 1 });
    expect(await uncheckedCount(project)).toBe(3);
  });
});
