import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { closeSql, getSql } from "@cortex/database";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp } from "../../apps/server/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `other-owner-${RID}@example.com`;
const MIGRATION = readFileSync(
  new URL("../../packages/database/migrations/0023_memo_type_other.sql", import.meta.url),
  "utf8",
);

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

const typeOf = async (id: string): Promise<string> =>
  ((await getSql()`SELECT type FROM memos WHERE id = ${id}`) as unknown as { type: string }[])[0]!.type;

let token: string;
let project: ProjectRef;

beforeAll(async () => {
  token = await tokenFor(OWNER);
  project = await createProject(`IT Other ${RID}`, { visibility: "private", ownerEmail: OWNER });
}, 120_000);

afterAll(async () => {
  await closeSql();
});

/**
 * Memos stored as `module_note` must follow the rename or drop out of the pack and the type
 * filter, and a CLI from before the rename must not get a 400 for the old name (ADR-0079).
 */
describe("module_note becomes other", () => {
  it("the migration moves the memos stored as module_note to other, and the old name can no longer be written", async () => {
    const sql = getSql();
    const { entry } = await saveContext(
      { project: project.name, type: "decision", content: `A memo stored before the rename ${RID}.` },
      { useClassifier: false, detectImprovements: false, skipEmbedding: true },
    );

    await sql`ALTER TABLE memos DROP CONSTRAINT memos_type_check`;
    try {
      await sql`UPDATE memos SET type = 'module_note' WHERE id = ${entry.id}`;
    } finally {
      await sql.unsafe(MIGRATION);
    }
    await sql.unsafe(MIGRATION);

    expect(await typeOf(entry.id)).toBe("other");
    await expect(sql`UPDATE memos SET type = 'module_note' WHERE id = ${entry.id}`).rejects.toThrow(/memos_type_check/);
  });

  it("a capture that still says module_note is stored as other", async () => {
    const res = await createApp().request("/capture", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        slug: project.slug,
        content: `A capture from a CLI installed before the rename ${RID}.`,
        type: "module_note",
      }),
    });

    expect(res.status).toBe(200);
    const { entryId } = (await res.json()) as { entryId: string };
    expect(await typeOf(entryId)).toBe("other");
  });
});
