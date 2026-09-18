import { lintProject } from "./lint.js";

/**
 * "Lint that acts": from the lint report, it proposes concrete ACTIONS to close the findings
 * (open tasks in the tracker for gaps and contradictions, consolidate duplicates). It is
 * **dry-run** by default: it prints the plan and does NOT write to external systems. Actually
 * running it (creating tasks in Plane) has side effects on production data and must be done
 * explicitly and supervised (see the README / the plane-api skill).
 */

export interface LintAction {
  kind: "open_task" | "consolidate";
  title: string;
  detail: string;
}

export async function planLintActions(project: string): Promise<LintAction[]> {
  const r = await lintProject(project);
  const actions: LintAction[] = [];

  for (const g of r.gaps) {
    actions.push({
      kind: "open_task",
      title: `Document the technical decision for the "${g.area}" area`,
      detail: `${g.incidents} incidents recorded and 0 decisions documented (${g.type}). The decision/criterion currently in force is worth capturing.`,
    });
  }
  for (const c of r.contradictions) {
    actions.push({
      kind: "open_task",
      title: `Resolve a contradiction in the context`,
      detail: `"${c.a}" <-> "${c.b}". Check which criterion is in force and mark the other obsolete/superseded.`,
    });
  }
  for (const d of r.duplicates.slice(0, 10)) {
    actions.push({
      kind: "consolidate",
      title: `Consolidate a likely duplicate (${d.score.toFixed(2)})`,
      detail: `"${d.a}" ~ "${d.b}". Merge into one canonical entry, or validate one and mark the other.`,
    });
  }
  return actions;
}
