export { configureCore, resetCore, type CorePorts } from "./composition.js";
export { MEMO_TYPE_DEFINITIONS, type MemoTypeDefinition } from "./knowledge/domain/memo-types.js";
export { defaultLanguage, keepsType } from "./projects/domain/project.js";
export { entityType, extractableEntityType, isUsableEntityName, type Entity, type EntityType, type ExtractableEntityType } from "./graph/domain/entity.js";
export { relationType, type Relation, type RelationType } from "./graph/domain/relation.js";
export * from "./knowledge/application/save.js";
export * from "./knowledge/application/search.js";
export * from "./knowledge/application/context-pack.js";
export * from "./knowledge/application/review.js";
export { isAwaitingReview, nextReview, pendingReviewCount, queueReviewsOfBatch, reviewsAwaiting, REVIEW_THRESHOLD } from "./knowledge/application/review-queue.js";
export { isReviewDecision, type Finding, type NewerMemo, type OlderMemo, type PendingReview, type ReviewDecision } from "./knowledge/domain/review-queue.js";
export { setGroupJudge, sweepProject, type GroupJudge, type SweepReport } from "./knowledge/application/review-sweep.js";
export { setMemoEditor, suggestEdits, suggestionFor, type MemoEditor } from "./knowledge/application/memo-suggestions.js";
export type { EditSource, MemoSuggestion } from "./knowledge/domain/memo-suggestion.js";
export { isGroupRelation, type GroupRelation, type JudgedGroup, type JudgeSource } from "./knowledge/domain/review-sweep.js";
export { nextUnchecked, uncheckedCount } from "./knowledge/application/verification-queue.js";
export {
  draftMergesAhead,
  mergeInReview,
  MERGE_DRAFTS_AHEAD,
  preparedMerge,
  proposeMerge,
  pruneMergeDrafts,
  setMergeDrafter,
  type MergeDrafter,
} from "./knowledge/application/review-merge.js";
export { isReviewLane, type MergeDraft, type MergedMemo, type MergeProposal, type MergeSource, type ReviewLane } from "./knowledge/domain/memo-merge.js";
export type { UncheckedMemo } from "./knowledge/domain/verification-queue.js";
export * from "./knowledge/application/queries.js";
export * from "./knowledge/application/render.js";
export type { Memo, MemoStatus, MemoType, Validity } from "./knowledge/domain/memo.js";
export {
  confidenceAfterReview,
  isReviewVerdict,
  type MemoReview,
  type Reviewer,
  type ReviewChannel,
  type ReviewVerdict,
} from "./knowledge/domain/review.js";
export type { Source } from "./knowledge/domain/source.js";
export { sliceTranscript, type SlicedTranscript } from "./capture/domain/transcript-windows.js";
export {
  latestProjectHealth,
  lintProject,
  renderLintReport,
  type HealthSnapshot,
  type LintReport,
} from "./knowledge/application/lint.js";
export { planLintActions, type LintAction } from "./knowledge/application/lint-act.js";
export { searchProjectCode, indexRepo, renderCodeHits, type CodeHit } from "./capture/application/code.js";
// Chunking, extension lists and directories to ignore live in `shared` now that the
// lightweight CLI needs them too (ADR-0058). They are re-exported so callers do not break.
export { chunkDocument, IGNORE_DIRS, SUPPORTED_EXTS, type ChunkOptions, type DocChunk } from "@cortex/shared";
export { applyTemporalInvalidation } from "./knowledge/application/temporal.js";
export { indexMemos } from "./knowledge/application/index-memos.js";
export { recordUsage, getUsageSummary, getUsageFacets, getRecentTraces, type UsageQuery } from "./observability/application/usage.js";
export {
  estimateCostUsd,
  resetPricingCache,
  endpointHost,
  USAGE_PERIODS,
  DEFAULT_USAGE_PERIOD,
  type UsageRecord,
  type UsageSummary,
  type UsageFacets,
  type UsageDay,
  type UsageFigures,
  type TraceTree,
  type TraceSpan,
} from "./observability/domain/usage.js";
export { registerUsageSink } from "./observability/infrastructure/embedding-usage-sink.js";
export { resolveEntity, relate, linkEntryToEntity } from "./graph/application/entities.js";
export { getAcrossClient } from "./graph/application/across.js";
export type { AcrossClient, SharedEntity, CrossProjectContradiction } from "./graph/domain/across.js";
export { resolveEntities, type ResolveResult } from "./graph/application/resolve-entities.js";
export { slugify } from "./projects/domain/slug.js";
export { findProjectBySlug, findProjectByName, getEntryProject, createProject, canAccessProject, checkProjectAccess, checkEntryAccess, listAccessibleProjects, listChildProjects, listProjectAncestors, addProjectMember, removeProjectMember, listProjectMembers, isProjectMember, canManageProject, canReviewProject, canReviewEntryProject, NotAReviewerError, updateProject, deleteProject, getProjectLanguage, getProjectCriteria, type ProjectLanguage, type ProjectCriteriaView, NotAManagerError, ProjectNotEmptyError, type ProjectRef, type AccessibleProject, type AccessCheck } from "./projects/application/projects.js";
export { agentPromptChain, getAgentPrompts, setAgentPrompts, NotAnAdminError } from "./projects/application/agent-prompts.js";
export { EMPTY_CHAIN, chainAt, effectiveCriterion, type AgentPrompt, type AgentPromptChain, type AgentPromptView } from "./projects/domain/agent-prompts.js";
export { agentModelFor, getAgentModels, setAgentModels, InvalidAgentModelError } from "./projects/application/agent-models.js";
export { AGENT_MODEL_MAX_LENGTH, isModelSpec, type AgentModelChanges, type SavedAgentModel } from "./projects/domain/agent-models.js";
export {
  purgeEntries,
  canManageEntryProject,
  findPurgeScope,
  purgeScope,
  summarizePurgeScope,
  type PurgeResult,
  type PurgeScope,
  type PurgeScopeSummary,
} from "./projects/application/purge.js";
export type { DatePeriod, ScopedMemo } from "./knowledge/domain/memo-repository.js";
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
} from "./knowledge/application/dedup.js";
export { autoCurate, type CurationResult } from "./knowledge/application/curate.js";
export { requestOtp, verifyOtp, authenticate, authenticateAccount, revokeToken, createUiTicket, redeemUiTicket } from "./auth/application/auth.js";
export { isAdmin, listAdmins, type Account } from "./auth/domain/auth.js";
export type { SessionUser } from "./auth/domain/session-user.js";
export type { EmailSender, EmailMessage } from "./auth/domain/email.js";
export { sendOtpEmail } from "./auth/application/otp-email.js";
export { getEmailSender, setEmailSender, validateEmailConfig } from "./auth/infrastructure/email-senders.js";
export {
  reviewDigestOn,
  sendReviewDigests,
  setReviewDigest,
  unsubscribeLink,
  unsubscribeWithToken,
  type DigestRun,
  type UnsubscribeLink,
} from "./notifications/application/review-digest.js";
export { captureBatch, relateEntries, type BatchItem, type BatchItemResult } from "./capture/application/capture.js";
export { extractFileText, setMediaExtractor, type ExtractedFile, type MediaExtractorHooks } from "./capture/infrastructure/extract.js";
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
} from "./capture/application/session-captures.js";
