import { describe, it, expect } from "vitest";
import { MAX_PURGE_IDS, purgeEntriesRequest } from "@cortex/shared";
import { describePurgeResult, isPurgeConfirmed } from "../apps/cli/src/purge.js";

const ID = "3f1c2b8e-8d4a-4c1e-9f7a-2b6d5e4c3a21";

/**
 * Purging is the one irreversible write (ADR-0072). An id that is not a UUID used to reach
 * Postgres as a 500 on the entry routes; here it must stop at the edge, and a list with the same
 * id twice must not count as two purges.
 */
describe("the purge request", () => {
  it("accepts UUIDs, and the same id twice (in any case) is one id", () => {
    const parsed = purgeEntriesRequest.parse({ ids: [ID, ID.toUpperCase()] });
    expect(parsed.ids).toEqual([ID]);
  });

  it("refuses an empty list, a non-UUID and more ids than one request may carry", () => {
    expect(purgeEntriesRequest.safeParse({ ids: [] }).success).toBe(false);
    expect(purgeEntriesRequest.safeParse({ ids: ["not-a-uuid"] }).success).toBe(false);
    expect(purgeEntriesRequest.safeParse({ ids: Array.from({ length: MAX_PURGE_IDS + 1 }, () => ID) }).success).toBe(false);
  });
});

/**
 * The CLI and the server are not in lockstep (ADR-0062). A server from before the purge answers
 * 404 to the endpoint, and reading that as "those entries do not exist" would tell somebody their
 * ids are wrong when it is their server that is old.
 */
describe("what `cortex mem purge` says about the answer", () => {
  it("a 404 with no error in the body is an old server, not missing entries", () => {
    const out = describePurgeResult({ ok: false, status: 404, data: {} });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/server/i);
  });

  it("a 404 that names the missing ids says which ones and that nothing was purged", () => {
    const out = describePurgeResult({ ok: false, status: 404, data: { error: "Entry not found.", missing: [ID] } });
    expect(out.message).toContain(ID);
    expect(out.message).toMatch(/nothing was purged/);
  });

  it("a refusal passes the server's reason through", () => {
    const out = describePurgeResult({ ok: false, status: 403, data: { error: 'Only the owner of "x" or an administrator can change this.' } });
    expect(out.message).toMatch(/Only the owner/);
  });

  it("success counts what was purged", () => {
    expect(describePurgeResult({ ok: true, status: 200, data: { purged: [ID] } }).message).toBe("purged 1 entry");
  });
});

/** A `y` is given by reflex; typing the word is not. */
describe("the purge confirmation", () => {
  it("only the word itself confirms", () => {
    expect(isPurgeConfirmed(" Purge \n")).toBe(true);
    for (const answer of ["y", "yes", "", "purg"]) expect(isPurgeConfirmed(answer)).toBe(false);
  });
});
