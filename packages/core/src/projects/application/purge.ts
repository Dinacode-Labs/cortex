import { isAdmin } from "../../auth/domain/auth.js";
import type { SessionUser } from "../../auth/domain/session-user.js";
import { canManageProject, findProjectBySlug, NotAManagerError, type ProjectRef } from "./projects.js";
import type { DatePeriod, PurgeTarget, ScopedMemo } from "../../knowledge/domain/memo-repository.js";
import type { MemoStatus, MemoType } from "../../knowledge/domain/memo.js";
import { port } from "../../composition.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function projectLabel(target: PurgeTarget): string {
  return target.projectSlug ?? target.projectName ?? "an entry with no project";
}

export interface PurgeResult {
  purged: string[];
}

export async function canManageEntryProject(actor: SessionUser | null, project: Pick<ProjectRef, "slug"> | null): Promise<boolean> {
  if (!actor) return false;
  if (project?.slug) return canManageProject(actor, project.slug);
  return isAdmin(actor);
}

/**
 * Purges entries for good (ADR-0072). The permission check is here, per project; the deletion
 * itself -- the entries, their dependants, the sources and entities left empty -- is one
 * transaction in the repository adapter.
 */
export async function purgeEntries(ids: string[], actor: SessionUser | null): Promise<PurgeResult> {
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
  if (wanted.length === 0) return { purged: [] };

  const repository = port("memos");
  const targets = await repository.findPurgeTargets(wanted);
  if (targets.length === 0) return { purged: [] };

  if (!actor) throw new NotAManagerError(projectLabel(targets[0]!));
  const byProject = new Map<string, PurgeTarget>();
  for (const t of targets) byProject.set(t.projectId ?? "", t);
  for (const t of byProject.values()) {
    const project = t.projectId ? { slug: t.projectSlug } : null;
    if (!(await canManageEntryProject(actor, project))) throw new NotAManagerError(projectLabel(t));
  }

  const purged = await repository.purge(targets.map((t) => t.id), actor.email);
  return { purged };
}

/** What a project-wide purge reaches, by its slug; see `MemoScope` for each field (ADR-0087). */
export interface PurgeScope {
  project: string;
  type?: MemoType;
  status?: MemoStatus;
  periods?: DatePeriod[];
  writtenBefore: Date;
}

export async function findPurgeScope(scope: PurgeScope, actor: SessionUser | null): Promise<ScopedMemo[]> {
  if (!(await canManageProject(actor, scope.project))) throw new NotAManagerError(scope.project);
  const project = await findProjectBySlug(scope.project);
  if (!project) return [];
  return port("memos").findInScope({
    projectId: project.id,
    type: scope.type,
    status: scope.status,
    periods: scope.periods,
    writtenBefore: scope.writtenBefore,
  });
}

export async function purgeScope(scope: PurgeScope, actor: SessionUser | null): Promise<PurgeResult> {
  const memos = await findPurgeScope(scope, actor);
  return purgeEntries(memos.map((m) => m.id), actor);
}

export interface PurgeScopeSummary {
  count: number;
  byType: Partial<Record<MemoType, number>>;
  oldest: Date | null;
  newest: Date | null;
}

export function summarizePurgeScope(memos: ScopedMemo[]): PurgeScopeSummary {
  const byType: Partial<Record<MemoType, number>> = {};
  let oldest: Date | null = null;
  let newest: Date | null = null;
  for (const m of memos) {
    byType[m.type] = (byType[m.type] ?? 0) + 1;
    if (!oldest || m.createdAt < oldest) oldest = m.createdAt;
    if (!newest || m.createdAt > newest) newest = m.createdAt;
  }
  return { count: memos.length, byType, oldest, newest };
}
