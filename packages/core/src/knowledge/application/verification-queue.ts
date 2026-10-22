import { port } from "../../composition.js";
import type { Memo } from "../domain/memo.js";
import type { UncheckedMemo } from "../domain/verification-queue.js";
import type { ProjectRef } from "../../projects/domain/project.js";
import { PACK_SECTIONS } from "./context-pack.js";

/** What the pack hands over first is what a wrong memo misleads most with (ADR-0093). */
const CHECK_ORDER = PACK_SECTIONS.map((s) => s.type);

export async function queueForVerification(memo: Memo): Promise<void> {
  if (!memo.projectId) return;
  await port("verificationQueue").enqueue(memo.id);
}

export async function nextUnchecked(project: Pick<ProjectRef, "id">): Promise<UncheckedMemo | null> {
  const memo = await port("verificationQueue").next(project.id, CHECK_ORDER);
  if (!memo) return null;
  return { memo, touches: await port("reviewQueue").raisedBy(project.id, memo.id) };
}

export async function uncheckedCount(project: Pick<ProjectRef, "id">): Promise<number> {
  return port("verificationQueue").pendingCount(project.id);
}
