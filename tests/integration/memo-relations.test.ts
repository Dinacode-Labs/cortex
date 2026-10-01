import { describe, it, expect, afterAll } from "vitest";
import { closeSql, getSql } from "@cortex/database";
import { createProject, relateEntries, saveContext } from "@cortex/core";

const RID = Date.now().toString(36);
afterAll(async () => {
  await closeSql();
});

/**
 * `relations` says in text what each end points at, and migration 0022 rewrote every
 * 'context_entry' to 'memo' (ADR-0077). Nothing reads the value back today, so a writer that
 * kept the old spelling would pass every other test and leave the graph speaking two dialects.
 */
describe("a relation between two memos", () => {
  it("is written with 'memo' at both ends, never the old 'context_entry'", async () => {
    const p = await createProject(`IT Memo relation ${RID}`);
    const opts = { useClassifier: false, detectImprovements: false } as const;
    const older = await saveContext({ content: "Deploys run on Fridays.", project: p.name, type: "decision" }, opts);
    const newer = await saveContext({ content: "Deploys never run on Fridays.", project: p.name, type: "decision" }, opts);

    await relateEntries(newer.entry.id, older.entry.id, "contradicts");

    const rows = (await getSql()`
      SELECT source_type, target_type FROM relations WHERE source_id = ${newer.entry.id} AND target_id = ${older.entry.id}
    `) as unknown as { source_type: string; target_type: string }[];
    expect(rows).toEqual([{ source_type: "memo", target_type: "memo" }]);
  });
});
