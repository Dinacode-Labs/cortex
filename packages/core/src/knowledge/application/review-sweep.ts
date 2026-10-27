import { getEnvNum, scrub, type Language } from "@cortex/shared";
import { port } from "../../composition.js";
import { findProjectIdByName, languageOfProject } from "../../projects/application/projects.js";
import { DUPLICATE_DISTANCE } from "../domain/health.js";
import type { Memo } from "../domain/memo.js";
import { oldestFirst } from "../domain/memo-merge.js";
import { suggestEdits } from "./memo-suggestions.js";
import {
  alikeGroup,
  groupsToRaise,
  pairKey,
  sweepGroup,
  type JudgedGroup,
  type JudgeSource,
  type SweepGroup,
} from "../domain/review-sweep.js";

/**
 * Below a save's 0.75: what reads alike but is about something else is set aside by the agent, so
 * the net can be wider than one a person has to sift by hand (ADR-0098).
 */
export const SWEEP_FLOOR = getEnvNum("CORTEX_SWEEP_FLOOR", 0.65);
export const SWEEP_NEIGHBOURS = getEnvNum("CORTEX_SWEEP_NEIGHBOURS", 12);
export const SWEEP_MAX_REVIEWS = getEnvNum("CORTEX_SWEEP_MAX_REVIEWS", 20);

/** Without a model a paraphrase and a contradiction look alike, so only what Health calls a likely duplicate is raised. */
const ALIKE_WITHOUT_MODEL = 1 - DUPLICATE_DISTANCE.sameType;

// A project's first pass looks at the last day only: the backlog stays out, as in ADR-0091 and 0093.
const FIRST_SWEEP_MS = 24 * 60 * 60 * 1000;

/**
 * It is handed the memo of the day and the older ones that read alike, and says which belong in one
 * review with it. Null, or a throw, falls back to similarity alone; an empty list means none does.
 */
export type GroupJudge = (memo: JudgeSource, alike: JudgeSource[], context: { language: Language; projectId: string }) => Promise<JudgedGroup[] | null>;

let judge: GroupJudge | null = null;

export function setGroupJudge(fn: GroupJudge | null): void {
  judge = fn;
}

export interface SweepReport {
  project: string;
  /** Memos of the window, each set against the whole project. */
  swept: number;
  judged: number;
  raised: number;
  /** Memos waiting to be checked that the editing agent proposed to rewrite or reject (ADR-0099). */
  suggested: number;
}

async function judgedGroups(memo: Memo, alike: Memo[], context: { language: Language; projectId: string }): Promise<JudgedGroup[] | null> {
  if (!judge) return null;
  const groups = await judge(memo, alike, context).catch(() => null);
  return groups && groups.filter((g) => g.memoIds.includes(memo.id));
}

async function toSweepGroup(memos: Memo[], knownPairs: Set<string>, judged: JudgedGroup | null): Promise<SweepGroup | null> {
  const [oldest, ...rest] = oldestFirst(memos);
  if (!oldest) return null;
  const similarities = await port("memoIndex").similarities(oldest.id, rest.map((m) => m.id));
  // The model's words are kept and shown later, so they are scrubbed like anything else persisted.
  const finding = judged && { relation: judged.relation, reason: scrub(judged.reason) };
  return sweepGroup(memos, similarities, knownPairs, finding);
}

/**
 * The nightly second pass (ADR-0098): every memo saved since the last one is set against the whole
 * project, with a wider net than a save casts, and what belongs together is raised as one review in
 * the older lane. Then the memos next in the lane of those not checked yet get the editing agent's
 * suggestion. It never changes a memo; a person decides, as for any review.
 */
export async function sweepProject(project: string, now = new Date()): Promise<SweepReport> {
  const report: SweepReport = { project, swept: 0, judged: 0, raised: 0, suggested: 0 };
  const projectId = await findProjectIdByName(project);
  if (!projectId) return report;
  const since = (await port("sweepLog").sweptUntil(projectId)) ?? new Date(now.getTime() - FIRST_SWEEP_MS);
  const memos = await port("memoReader").savedBetween(projectId, since, now);
  const { effective: language } = await languageOfProject(projectId);

  const groups: SweepGroup[] = [];
  const grouped = new Set<string>();
  for (const memo of memos) {
    report.swept++;
    if (grouped.has(memo.id)) continue;
    const neighbours = (await port("memoIndex").neighboursOf(memo.id, { projectId, excludeId: memo.id }, SWEEP_NEIGHBOURS)).filter(
      (hit) => hit.score >= SWEEP_FLOOR,
    );
    if (neighbours.length === 0) continue;
    const byId = new Map<string, Memo>([[memo.id, memo], ...neighbours.map((hit) => [hit.entry.id, hit.entry] as const)]);
    const knownPairs = await port("reviewQueue").knownPairs([...byId.keys()]);
    if (neighbours.every((hit) => knownPairs.has(pairKey(memo.id, hit.entry.id)))) continue;

    if (judge) report.judged++;
    const judged = await judgedGroups(memo, neighbours.map((hit) => hit.entry), { language, projectId });
    const found: { ids: string[]; judged: JudgedGroup | null }[] = judged
      ? judged.map((g) => ({ ids: g.memoIds, judged: g }))
      : [{ ids: alikeGroup(memo, neighbours, ALIKE_WITHOUT_MODEL), judged: null }];
    for (const { ids, judged: verdict } of found) {
      const members = ids.map((id) => byId.get(id)).filter((m): m is Memo => m !== undefined);
      if (members.length < 2) continue;
      for (const m of members) grouped.add(m.id);
      const group = await toSweepGroup(members, knownPairs, verdict);
      if (group) groups.push(group);
    }
  }

  const raised = groupsToRaise(groups, SWEEP_MAX_REVIEWS);
  for (const group of raised) await port("reviewQueue").raiseGroup(projectId, group);
  report.raised = raised.length;
  await port("sweepLog").record(projectId, now);
  // After the groups are raised, so a memo in one is not also proposed a rewrite of its own.
  report.suggested = await suggestEdits(projectId);
  return report;
}
