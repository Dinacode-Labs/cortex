import { describe, it, expect } from "vitest";
import { MAX_PURGE_IDS, purgeEntriesRequest, purgeProjectRequest } from "@cortex/shared";
import {
  describePurgePreview,
  describePurgeResult,
  isPurgeConfirmed,
  isSlugConfirmed,
  parsePurgeScope,
  PROJECT_PURGE_UNSUPPORTED,
} from "../apps/cli/src/purge.js";

const ID = "3f1c2b8e-8d4a-4c1e-9f7a-2b6d5e4c3a21";

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

describe("the purge confirmation", () => {
  it("only the word itself confirms", () => {
    expect(isPurgeConfirmed(" Purge \n")).toBe(true);
    for (const answer of ["y", "yes", "", "purg"]) expect(isPurgeConfirmed(answer)).toBe(false);
  });

  /*
   * Purging a whole project takes memos nobody read one by one (ADR-0087). "yes" and the word
   * "purge" are typed from habit; the slug has to be read off the screen, which is the point.
   */
  it("purging a project takes its slug typed back exactly, and nothing else", () => {
    expect(isSlugConfirmed(" acme-portal\n", "acme-portal")).toBe(true);
    for (const answer of ["y", "yes", "purge", "Acme-Portal", "acme", ""]) expect(isSlugConfirmed(answer, "acme-portal"), answer).toBe(false);
  });
});

/*
 * `cortex mem purge --all` with a typo in --from must not turn into "everything": every flag that
 * fails to parse refuses the command rather than being dropped from the scope.
 */
describe("the scope `cortex mem purge` reads from its flags", () => {
  it("no scope flag means the ids on the command line, as before", () => {
    expect(parsePurgeScope({ all: false })).toBeNull();
  });

  it("--type or --status alone is refused: they narrow a scope, they are not one", () => {
    expect(parsePurgeScope({ all: false, type: "other" })).toHaveProperty("error");
    expect(parsePurgeScope({ all: false, status: "draft" })).toHaveProperty("error");
  });

  it("--from and --to are whole UTC days, both included", () => {
    expect(parsePurgeScope({ all: false, from: "2026-09-28", to: "2026-10-04" })).toEqual({
      scope: { periods: [{ field: "created", from: "2026-09-28T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" }] },
    });
    expect(parsePurgeScope({ all: false, from: "2026-10-05", to: "2026-10-05" })).toEqual({
      scope: { periods: [{ field: "created", from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" }] },
    });
  });

  it("one end may stay open", () => {
    expect(parsePurgeScope({ all: false, to: "2026-01-31" })).toEqual({
      scope: { periods: [{ field: "created", from: undefined, to: "2026-02-01T00:00:00.000Z" }] },
    });
  });

  it("--all with filters is the whole project narrowed by them; an old type name still works", () => {
    expect(parsePurgeScope({ all: true })).toEqual({ scope: {} });
    expect(parsePurgeScope({ all: true, type: "module_note", status: "draft" })).toEqual({ scope: { type: "other", status: "draft" } });
  });

  it("refuses an impossible day, a reversed span and an unknown type or status", () => {
    const refused = [
      { all: false, from: "2026-02-30" },
      { all: false, from: "2026-9-1" },
      { all: false, from: "2026-10-05", to: "2026-10-01" },
      { all: true, type: "decisions" },
      { all: true, status: "done" },
    ].filter((flags) => !(parsePurgeScope(flags) && "error" in parsePurgeScope(flags)!));
    expect(refused).toEqual([]);
  });

  it("what it builds is what the server accepts", () => {
    const parsed = parsePurgeScope({ all: false, from: "2026-09-28", to: "2026-10-04", type: "decision" });
    expect(parsed && "scope" in parsed && purgeProjectRequest.safeParse(parsed.scope).success).toBe(true);
  });
});

describe("the project purge request", () => {
  it("a period needs at least one end, and `from` before `to`", () => {
    const at = (day: string) => `${day}T00:00:00.000Z`;
    expect(purgeProjectRequest.safeParse({ periods: [{}] }).success).toBe(false);
    expect(purgeProjectRequest.safeParse({ periods: [{ from: at("2026-10-05"), to: at("2026-10-05") }] }).success).toBe(false);
    expect(purgeProjectRequest.safeParse({ periods: [{ from: "yesterday" }] }).success).toBe(false);
    expect(purgeProjectRequest.parse({ periods: [{ from: at("2026-10-05") }] }).periods![0]!.field).toBe("created");
  });
});

describe("what `cortex mem purge --all` shows and says", () => {
  it("before asking, how many, of which project, of which types and between which days", () => {
    const text = describePurgePreview(
      { count: 3, byType: { decision: 1, other: 2 }, oldest: "2026-09-01T10:00:00.000Z", newest: "2026-10-05T09:00:00.000Z", asOf: "2026-10-06T00:00:00.000Z" },
      "acme-portal",
    );
    expect(text).toContain('purge 3 entries of "acme-portal"');
    expect(text).toContain("between 2026-09-01 and 2026-10-05");
    expect(text).toContain("other 2 · decision 1");
    expect(text).toMatch(/child project keeps its own/);
  });

  it("a 404 with no error from the project endpoint is an old server", () => {
    expect(describePurgeResult({ ok: false, status: 404, data: {} }, PROJECT_PURGE_UNSUPPORTED).message).toBe(PROJECT_PURGE_UNSUPPORTED);
  });
});
