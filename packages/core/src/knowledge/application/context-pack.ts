import type { ProjectCriteria } from "@cortex/shared";
import { criteriaOfProject, findProjectByName, projectIdsWithAncestors } from "../../projects/application/projects.js";
import { port } from "../../composition.js";
import type { SearchHit } from "../domain/memo-index.js";
import type { Memo, MemoStatus, MemoType } from "../domain/memo.js";

export async function validateEntry(
  id: string,
  status: Extract<MemoStatus, "validated" | "rejected" | "obsolete">,
): Promise<Memo | null> {
  return port("memos").setStatus(id, status);
}

/**
 * Which knowledge types go into the pack, in what order and with how much weight.
 *
 * This list is the reason this file exists, so it is worth reading slowly. The pack used to
 * carry only five types -- decisions, constraints, risks, debt and conventions -- because they
 * were five fields hand-written into the interface. The other nine existed, were stored and
 * were counted... and never reached an agent. Measured in a real project: **172 of 348 current
 * entries, 51%**, of types the pack did not render. Among them 38 incidents, while the same
 * project's lint warned about "incidents with no decision".
 *
 * Left out on purpose are the three types that are a **record of an event** rather than the
 * project's state: meeting, PR and ticket summaries. An agent opening a session needs to know
 * how the project stands, not what happened in a meeting back in March; that gets searched for
 * when needed. It is a decision, not an oversight -- which was exactly the earlier problem.
 *
 * The weight splits the budget: what governs today's work weighs twice what merely accompanies
 * it. See ADR-0054.
 */
export const PACK_SECTIONS: { type: MemoType; title: string; weight: number }[] = [
  { type: "decision", title: "Decisions in force", weight: 2 },
  { type: "constraint", title: "Active constraints", weight: 2 },
  { type: "risk", title: "Known risks", weight: 2 },
  { type: "technical_debt", title: "Technical debt", weight: 2 },
  { type: "convention", title: "Conventions", weight: 2 },
  { type: "architecture", title: "Architecture", weight: 2 },
  { type: "business_rule", title: "Business rules", weight: 2 },
  { type: "incident", title: "Past incidents", weight: 1 },
  { type: "integration_note", title: "Integrations", weight: 1 },
  { type: "how_to", title: "How to", weight: 1 },
  { type: "other", title: "Other", weight: 1 },
];

export interface PackSection {
  type: MemoType;
  title: string;
  weight: number;
  entries: Memo[];
}

export interface ContextPack {
  project: string;
  generatedAt: Date;
  criteria?: ProjectCriteria;
  sections: PackSection[];
  sensitiveModules: string[];
  relevantToArea: SearchHit[];
  totalEntries: number;
  /**
   * Pairs of pack entries that contradict each other.
   *
   * Neither is invalidated: which one is redundant is a judgement that cannot be made
   * automatically without risking deleting the good one. But keeping quiet is worse, because
   * the pack hands over both as current and the agent decides blind. Seen in real trials: two
   * different agents spotted it on their own and said so, which is a sign the warning was
   * needed.
   */
  conflicts: EntryConflict[];
}

export interface EntryConflict {
  entryId: string;
  entries: { label: string; recordedLater: boolean }[];
  /**
   * Areas this entry touches that are under dispute. It is phrased that way, rather than "this
   * entry contradicts X", because that is not true: the entry hangs off an entity that
   * contradicts X, which is considerably less. Asserting the concrete pair produced absurd
   * warnings -- a decision about backoff "contradicting" the daily reconciliation -- and a
   * warning that lies teaches people to ignore every warning.
   */
  areas: { entity: string; against: string[] }[];
}

export async function getContextPack(project: string, area?: string, asOf?: Date): Promise<ContextPack> {
  const reader = port("memoReader");
  // Resolved by slug or by name (#136); the pack carries the project's NAME, not whatever was
  // typed, so the header does not say "acme-portal" when the project is called Acme Portal.
  const resolved = await findProjectByName(project);
  const projectId = resolved?.id;
  if (!resolved || !projectId) {
    throw new Error(`Project not found: "${project}".`);
  }

  const ids = await projectIdsWithAncestors(projectId);
  const byType = await Promise.all(PACK_SECTIONS.map((s) => reader.byType(ids, s.type, asOf, 20)));
  const sections: PackSection[] = PACK_SECTIONS.map((s, i) => ({ ...s, entries: byType[i]! })).filter(
    (s) => s.entries.length > 0,
  );

  const sensitiveModules = await reader.moduleNames(projectId);
  const totalEntries = await reader.countInProject(projectId);
  const conflicts = await entryConflicts(ids);

  let relevantToArea: SearchHit[] = [];
  if (area) {
    relevantToArea = await port("memoIndex").similar(area, { projectId, asOf }, 5);
  }

  return {
    project: resolved.name,
    generatedAt: new Date(),
    criteria: (await criteriaOfProject(projectId)).effective,
    sections,
    sensitiveModules,
    relevantToArea,
    totalEntries,
    conflicts,
  };
}

/**
 * Contradictions affecting the pack's CURRENT entries.
 *
 * They arrive by two paths and are reported differently. Reconciliation relates ENTRY to ENTRY
 * when something new contradicts something curated: there we know who against whom, and we say
 * it. The graph enrichment in `maintain` relates ENTITIES to each other ("README" contradicts
 * "src/webhook.js"), which is the frequent case; there all we can say is that the area is
 * disputed, because an entry hanging off "README" does not necessarily contradict anything.
 */

async function entryConflicts(projectIds: string[]): Promise<EntryConflict[]> {
  const direct = new Map<string, { label: string; recordedLater: boolean }[]>();
  const areas = new Map<string, Map<string, Set<string>>>();

  // 1) Entry-to-entry: besides what it clashes with, which one was recorded first.
  const betweenEntries = await port("memos").contradictingPairs(projectIds, 25);
  const noteDirect = (id: string, label: string, recordedLater: boolean): void => {
    const list = direct.get(id) ?? [];
    if (!list.some((x) => x.label === label)) list.push({ label, recordedLater });
    direct.set(id, list);
  };
  for (const { a, b } of betweenEntries) {
    const aIsNewer = a.createdAt >= b.createdAt;
    noteDirect(a.id, b.title, !aIsNewer);
    noteDirect(b.id, a.title, aIsNewer);
  }

  // 2) Disputed entities: the memos caught on one side of an argument between entities.
  const withEntities = await port("memoReader").disputedAreas(projectIds, 200);
  for (const r of withEntities) {
    const byArea = areas.get(r.entryId) ?? new Map<string, Set<string>>();
    const against = byArea.get(r.area) ?? new Set<string>();
    against.add(r.against);
    byArea.set(r.area, against);
    areas.set(r.entryId, byArea);
  }

  // Caps: a warning longer than this stops being read and starts being skipped.
  const ids = new Set([...direct.keys(), ...areas.keys()]);
  return [...ids].map((entryId) => ({
    entryId,
    entries: (direct.get(entryId) ?? []).slice(0, 3),
    areas: [...(areas.get(entryId) ?? new Map())].slice(0, 2).map(([entity, against]) => ({
      entity,
      against: [...against].slice(0, 3),
    })),
  }));
}
