export * from "./save.js";
export * from "./search.js";
export * from "./context-pack.js";
export * from "./queries.js";
export * from "./render.js";
export { lintProject, renderLintReport, type LintReport } from "./lint.js";
export { planLintActions, type LintAction } from "./lint-act.js";
export { searchProjectCode, indexRepo, renderCodeHits, type CodeHit } from "./code.js";
// Chunking, extension lists and directories to ignore live in `shared` now that the
// lightweight CLI needs them too (ADR-0058). They are re-exported so callers do not break.
export { chunkDocument, IGNORE_DIRS, SUPPORTED_EXTS, type ChunkOptions, type DocChunk } from "@cortex/shared";
export { applyTemporalInvalidation } from "./temporal.js";
export { storeEmbeddingsBatch } from "./vectors.js";
export { recordUsage, registerUsageSink, getUsageSummary, getRecentTraces, estimateCostUsd, resetPricingCache, type UsageRecord, type UsageSummary, type TraceTree, type TraceSpan } from "./usage.js";
export { resolveEntity, relate, linkEntryToEntity } from "./entities.js";
export {
  getAcrossClient,
  type AcrossClient,
  type SharedEntity,
  type CrossProjectContradiction,
} from "./across.js";
export { resolveEntities, type ResolveResult } from "./resolve-entities.js";
// `readCortexLink` lives in @cortex/client (it is client-side code, with no SQL); it is
// re-exported here because core uses it to resolve a repo's project.
export { readCortexLink, type CortexLink } from "@cortex/client";
export { slugify } from "./project-config.js";
export { findProjectBySlug, findProjectByName, getEntryProject, createProject, resolveLinkedProject, canAccessProject, checkProjectAccess, checkEntryAccess, listAccessibleProjects, listChildProjects, listProjectAncestors, addProjectMember, removeProjectMember, listProjectMembers, isProjectMember, canManageProject, updateProject, deleteProject, NotAManagerError, ProjectNotEmptyError, type ProjectRef, type AccessibleProject, type AccessCheck } from "./projects.js";
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
} from "./dedup.js";
export { autoCurate, type CurationResult } from "./curate.js";
export { requestOtp, verifyOtp, validateToken, revokeToken, createUiTicket, redeemUiTicket, isAdmin, isAllowedEmail, listAdmins, type AuthUser } from "./auth.js";
export {
  sendOtpEmail,
  getEmailSender,
  setEmailSender,
  validateEmailConfig,
  type EmailSender,
  type EmailMessage,
} from "./email.js";
export { captureBatch, relateEntries, type BatchItem, type BatchItemResult } from "./capture.js";
export { extractFileText, setMediaExtractor, type ExtractedFile, type MediaExtractorHooks } from "./extract.js";
export {
  classifyType,
  extractEntities,
  canonicalize,
  deriveTitle,
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
} from "./session-captures.js";
