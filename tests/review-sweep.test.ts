import { describe, it, expect } from "vitest";
import type { Memo, SearchHit } from "../packages/core/src/index";
import { alikeGroup, groupsToRaise, pairKey, sweepGroup, type SweepGroup } from "../packages/core/src/knowledge/domain/review-sweep";
import { parseGroups } from "../packages/agents/src/agents/judge/judge";
import { judgePrompt } from "../packages/agents/src/agents/judge/prompt";

const memo = (id: string, day: string): Memo =>
  ({ id, title: `Memo ${id}`, content: `What ${id} says.`, type: "decision", createdAt: new Date(`2026-10-${day}T10:00:00Z`) }) as Memo;

const A = memo("a", "01");
const B = memo("b", "10");
const C = memo("c", "22");

const similarities = new Map([
  ["b", 0.81],
  ["c", 0.7],
]);

/*
 * A save sets a memo against the six nearest, and the reconciler against the nearest alone, so a
 * third memo saying the same thing came up as a second review, or not at all. The nightly pass
 * raises the group as one review, on its oldest memo, so a person sees all of it at once (ADR-0098).
 */
describe("a group the nightly pass raises", () => {
  it("is one review on its oldest memo, every other memo set against it, whatever order they came in", () => {
    const group = sweepGroup([C, A, B], similarities, new Set(), null);
    expect(group).toMatchObject({ anchorId: "a", members: [{ memoId: "b", similarity: 0.81 }, { memoId: "c", similarity: 0.7 }] });
  });

  it("leaves out a memo a person already judged against the oldest, in either order", () => {
    const decided = new Set([pairKey("b", "a")]);
    expect(sweepGroup([A, B, C], similarities, decided, null)?.members.map((m) => m.memoId)).toEqual(["c"]);
  });

  it("raises nothing when every memo of it was already set against the oldest", () => {
    expect(sweepGroup([A, B, C], similarities, new Set([pairKey("a", "b"), pairKey("a", "c")]), null)).toBeNull();
  });

  it("carries what the agent said of it, and an empty reason is no reason", () => {
    expect(sweepGroup([A, B], similarities, new Set(), { relation: "duplicate", reason: "Both fix the backoff at 30 s." })).toMatchObject({
      relation: "duplicate",
      reason: "Both fix the backoff at 30 s.",
    });
    expect(sweepGroup([A, B], similarities, new Set(), { relation: "duplicate", reason: "" })?.reason).toBeNull();
  });
});

/*
 * One night can bring hundreds of memos from an upload. The cap keeps the pass from burying the
 * queue, and what it keeps must be what misleads most: two memos in force that disagree.
 */
describe("which groups a night raises", () => {
  const raised = (relation: SweepGroup["relation"], similarity: number) => sweepGroup([A, B], new Map([["b", similarity]]), new Set(), relation && { relation, reason: "r" })!;

  it("a contradiction first, then a duplicate, then an overlap, and what no model judged last", () => {
    const groups = [raised(null, 0.99), raised("overlap", 0.7), raised("duplicate", 0.7), raised("contradiction", 0.66)];
    expect(groupsToRaise(groups, 10).map((g) => g.relation)).toEqual(["contradiction", "duplicate", "overlap", null]);
  });

  it("no more than the cap", () => {
    expect(groupsToRaise([raised(null, 0.9), raised(null, 0.95), raised(null, 0.91)], 2).map((g) => g.members[0]!.similarity)).toEqual([0.95, 0.91]);
    expect(groupsToRaise([raised(null, 0.9)], 0)).toEqual([]);
  });
});

describe("without a model", () => {
  it("only what reads close enough to be the same thing joins the memo of the day", () => {
    const hits = [
      { entry: B, score: 0.9 },
      { entry: C, score: 0.7 },
    ] as SearchHit[];
    expect(alikeGroup(A, hits, 0.85)).toEqual(["a", "b"]);
    expect(alikeGroup(A, hits, 0.95)).toEqual([]);
  });
});

/*
 * The agent's answer decides which memos a person is shown together. A number it invents, or a
 * group that leaves out the memo it was asked about, must not reach the queue as if it had been
 * judged.
 */
describe("what the review agent answers", () => {
  const ids = ["day", "older-1", "older-2"];

  it("is read as groups of the memos it was shown, by their number", () => {
    const answer = '```json\n{"groups":[{"memos":[0,2],"relation":"contradiction","reason":"One says 30 s, the other 60 s."}]}\n```';
    expect(parseGroups(answer, ids)).toEqual([{ memoIds: ["day", "older-2"], relation: "contradiction", reason: "One says 30 s, the other 60 s." }]);
  });

  it("drops a group without the memo of the day, one alone, a number never shown and a relation it was not offered", () => {
    const answer = JSON.stringify({
      groups: [
        { memos: [1, 2], relation: "duplicate", reason: "x" },
        { memos: [0], relation: "duplicate", reason: "x" },
        { memos: [0, 7], relation: "duplicate", reason: "x" },
        { memos: [0, 1], relation: "related", reason: "x" },
        { memos: [0, 1, 1], relation: "overlap" },
      ],
    });
    expect(parseGroups(answer, ids)).toEqual([{ memoIds: ["day", "older-1"], relation: "overlap", reason: "" }]);
  });

  it("an answer that is not the contract's shape is no verdict, so the pass falls back to similarity", () => {
    expect([parseGroups("I think they are alike.", ids), parseGroups('{"answer": []}', ids)]).toEqual([null, null]);
    expect(parseGroups('{"groups": []}', ids)).toEqual([]);
  });

  it("is shown each memo with its number, type and day, the memo of the day as 0", () => {
    const prompt = judgePrompt(A, [B, C]);
    for (const shown of ["[0] decision · saved 2026-10-01", "[1] decision · saved 2026-10-10", "[2] decision · saved 2026-10-22"]) expect(prompt).toContain(shown);
  });
});
