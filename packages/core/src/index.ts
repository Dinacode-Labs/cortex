export { configureCore, resetCore, type CorePorts } from "./composition.js";
export * from "./knowledge/save.js";
export * from "./knowledge/search.js";
export * from "./knowledge/context-pack.js";
export * from "./knowledge/queries.js";
export * from "./knowledge/render.js";
export type { Memo, MemoStatus, MemoType } from "./knowledge/domain/memo.js";
export { lintProject, renderLintReport, type LintReport } from "./knowledge/lint.js";
export { planLintActions, type LintAction } from "./knowledge/lint-act.js";
export { searchProjectCode, indexRepo, renderCodeHits, type CodeHit } from "./capture/code.js";
// Chunking, extension lists and directories to ignore live in `shared` now that the
// lightweight CLI needs them too (ADR-0058). They are re-exported so callers do not break.
export { chunkDocument, IGNORE_DIRS, SUPPORTED_EXTS, type ChunkOptions, type DocChunk } from "@cortex/shared";
export { applyTemporalInvalidation } from "./knowledge/temporal.js";
export { storeEmbeddingsBatch } from "./storage/vectors.js";
export { recordUsage, getUsageSummary, getRecentTraces } from "./observability/application/usage.js";
export { estimateCostUsd, resetPricingCache, type UsageRecord, type UsageSummary, type TraceTree, type TraceSpan } from "./observability/domain/usage.js";
export { registerUsageSink } from "./observability/infrastructure/embedding-usage-sink.js";
export { resolveEntity, relate, linkEntryToEntity } from "./graph/application/entities.js";
export { getAcrossClient } from "./graph/application/across.js";
export type { AcrossClient, SharedEntity, CrossProjectContradiction } from "./graph/domain/across.js";
export { resolveEntities, type ResolveResult } from "./graph/application/resolve-entities.js";
// `readCortexLink` lives in @cortex/client (it is client-side code, with no SQL); it is
// re-exported here because core uses it to resolve a repo's project.
export { readCortexLink, type CortexLink } from "@cortex/client";
export { slugify } from "./projects/project-config.js";
export { findProjectBySlug, findProjectByName, getEntryProject, createProject, resolveLinkedProject, canAccessProject, checkProjectAccess, checkEntryAccess, listAccessibleProjects, listChildProjects, listProjectAncestors, addProjectMember, removeProjectMember, listProjectMembers, isProjectMember, canManageProject, updateProject, deleteProject, getProjectLanguage, getProjectCriteria, type ProjectLanguage, type ProjectCriteriaView, NotAManagerError, ProjectNotEmptyError, type ProjectRef, type AccessibleProject, type AccessCheck } from "./projects/projects.js";
export { purgeEntries, canManageEntryProject, type PurgeResult } from "./projects/purge.js";
export {
  isNearDuplicate,
  findNearest,
  updateEntryContent,
  updateEntryFields,
  recordCorroboration,
  invalidateEntry,
  setReconciler,
  saveWithReconciliation,
  reconcileProject,
  UPDATE_THRESHOLD,
  NOOP_THRESHOLD,
  type NearestEntry,
  type ReconcilerHooks,
  type ReconcileAction,
  type ReconcileResult,
} from "./knowledge/dedup.js";
export { autoCurate, type CurationResult } from "./knowledge/curate.js";
export { requestOtp, verifyOtp, authenticate, authenticateAccount, revokeToken, createUiTicket, redeemUiTicket, isAdmin, listAdmins, type Account } from "./auth/auth.js";
export type { SessionUser } from "./auth/session-user.js";
export {
  sendOtpEmail,
  getEmailSender,
  setEmailSender,
  validateEmailConfig,
  type EmailSender,
  type EmailMessage,
} from "./auth/email.js";
export { captureBatch, relateEntries, type BatchItem, type BatchItemResult } from "./capture/capture.js";
export { extractFileText, setMediaExtractor, type ExtractedFile, type MediaExtractorHooks } from "./capture/extract.js";
export {
  classifyType,
  extractEntities,
  canonicalize,
  deriveTitle,
  isDerivedSummary,
  stripMarkdown,
  summarize,
} from "./text.js";
export {
  findSessionCapture,
  getSessionCaptureById,
  hashCondensed,
  markSessionCapture,
  reapStuckSessionCaptures,
  upsertSessionCapture,
  type SessionCapture,
  type SessionCaptureStatus,
} from "./capture/session-captures.js";
