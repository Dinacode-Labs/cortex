import { port } from "../../composition.js";
import { listChildProjects } from "../../projects/projects.js";
import type { ProjectRef } from "../../projects/domain/project.js";
import type { SessionUser } from "../../auth/session-user.js";
import { STACK_TYPES, type AcrossClient, type CrossProjectContradiction } from "../domain/across.js";

/**
 * A client's cross-cutting view, already filtered by permissions.
 *
 * The filter lives here rather than in the interface because it is the easy part to forget: a
 * private child that `viewer` is not a member of must appear neither in the shared stack nor in
 * the contradictions, even when the parent is visible. Everything that crosses over comes from
 * `listChildProjects`.
 */
export async function getAcrossClient(parent: ProjectRef, viewer: SessionUser | null): Promise<AcrossClient> {
  const children = await listChildProjects(parent.id, viewer);
  if (children.length === 0) return { children: [], sharedStack: [], contradictions: [] };

  const childIds = children.map((c) => c.id);
  const [sharedStack, contradictions] = await Promise.all([
    port("entities").sharedStack(childIds, STACK_TYPES, 40),
    crossProjectContradictions([parent.id, ...childIds]),
  ]);
  return { children, sharedStack, contradictions };
}

/**
 * Clashes between entries of DIFFERENT projects in the subtree.
 *
 * `lintProject` looks at one project, so a repo's decision clashing with its sibling's showed
 * up in neither report. The pack's pair query is reused and only what crosses over is kept:
 * within a single project, Health already reports it.
 */
async function crossProjectContradictions(projectIds: string[]): Promise<CrossProjectContradiction[]> {
  const pairs = await port("memos").contradictingPairs(projectIds, 50);
  const crossing = pairs.filter((p) => p.a.projectId && p.b.projectId && p.a.projectId !== p.b.projectId);
  if (crossing.length === 0) return [];

  const ids = [...new Set(crossing.flatMap((p) => [p.a.projectId!, p.b.projectId!]))];
  const byId = new Map((await port("projects").findByIds(ids)).map((p) => [p.id, { name: p.name, slug: p.slug }]));
  const unnamed = { name: "?", slug: null };

  return crossing.map((p) => ({
    a: { id: p.a.id, title: p.a.title, project: byId.get(p.a.projectId!) ?? unnamed },
    b: { id: p.b.id, title: p.b.title, project: byId.get(p.b.projectId!) ?? unnamed },
  }));
}
