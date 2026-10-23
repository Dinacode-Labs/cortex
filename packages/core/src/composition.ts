import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import type { AuthRepository } from "./auth/domain/auth-repository.js";
import type { CodeIndex, SourceTree } from "./capture/domain/code.js";
import type { SessionCaptureRepository } from "./capture/domain/session-capture.js";
import { PgCodeIndex } from "./capture/infrastructure/code.index.js";
import { PgSessionCaptureRepository } from "./capture/infrastructure/session-capture.repository.js";
import { FsSourceTree } from "./capture/infrastructure/source-tree.js";
import type { EmailSender } from "./auth/domain/email.js";
import { PgAuthRepository } from "./auth/infrastructure/auth.repository.js";
import { getEmailSender } from "./auth/infrastructure/email-senders.js";
import type { EntityRepository } from "./graph/domain/entity-repository.js";
import { PgEntityRepository } from "./graph/infrastructure/entity.repository.js";
import type { MemoRepository } from "./knowledge/domain/memo-repository.js";
import type { MemoIndex } from "./knowledge/domain/memo-index.js";
import type { MemoReader } from "./knowledge/domain/memo-reader.js";
import type { ReviewQueue } from "./knowledge/domain/review-queue.js";
import type { MergeDraftStore } from "./knowledge/domain/memo-merge.js";
import { PgMergeDraftStore } from "./knowledge/infrastructure/merge-draft.repository.js";
import type { SweepLog } from "./knowledge/domain/review-sweep.js";
import { PgSweepLog } from "./knowledge/infrastructure/sweep-log.repository.js";
import type { MemoSuggestionStore } from "./knowledge/domain/memo-suggestion.js";
import { PgMemoSuggestionStore } from "./knowledge/infrastructure/memo-suggestion.repository.js";
import { PgReviewQueue } from "./knowledge/infrastructure/review-queue.repository.js";
import type { VerificationQueue } from "./knowledge/domain/verification-queue.js";
import { PgVerificationQueue } from "./knowledge/infrastructure/verification-queue.repository.js";
import type { HealthReader, HealthSnapshots } from "./knowledge/domain/health.js";
import { PgMemoReader } from "./knowledge/infrastructure/memo.reader.js";
import { PgHealthReader } from "./knowledge/infrastructure/health.reader.js";
import { PgHealthSnapshots } from "./knowledge/infrastructure/health-snapshots.repository.js";
import { PgMemoIndex } from "./knowledge/infrastructure/memo.index.js";
import type { UsageRepository } from "./observability/domain/usage.js";
import { PgUsageRepository } from "./observability/infrastructure/usage.repository.js";
import { PgMemoRepository } from "./knowledge/infrastructure/memo.repository.js";
import type { ProjectRepository } from "./projects/domain/project-repository.js";
import { PgProjectRepository } from "./projects/infrastructure/project.repository.js";
import type { AgentPromptRepository } from "./projects/domain/agent-prompt-repository.js";
import { PgAgentPromptRepository } from "./projects/infrastructure/agent-prompt.repository.js";
import type { DigestSubscriptions } from "./notifications/domain/digest-subscriptions.js";
import { PgDigestSubscriptions } from "./notifications/infrastructure/digest-subscriptions.repository.js";

export interface CorePorts {
  memos: MemoRepository;
  memoIndex: MemoIndex;
  memoReader: MemoReader;
  reviewQueue: ReviewQueue;
  verificationQueue: VerificationQueue;
  mergeDrafts: MergeDraftStore;
  sweepLog: SweepLog;
  memoSuggestions: MemoSuggestionStore;
  health: HealthReader;
  healthSnapshots: HealthSnapshots;
  projects: ProjectRepository;
  agentPrompts: AgentPromptRepository;
  entities: EntityRepository;
  usage: UsageRepository;
  auth: AuthRepository;
  email: EmailSender;
  digestSubscriptions: DigestSubscriptions;
  sessionCaptures: SessionCaptureRepository;
  codeIndex: CodeIndex;
  sourceTree: SourceTree;
}

const defaults: { [P in keyof CorePorts]: () => CorePorts[P] } = {
  memos: () => new PgMemoRepository(getSql()),
  memoIndex: () => new PgMemoIndex(getSql(), getEmbeddingProvider()),
  memoReader: () => new PgMemoReader(getSql()),
  reviewQueue: () => new PgReviewQueue(getSql()),
  verificationQueue: () => new PgVerificationQueue(getSql()),
  mergeDrafts: () => new PgMergeDraftStore(getSql()),
  sweepLog: () => new PgSweepLog(getSql()),
  memoSuggestions: () => new PgMemoSuggestionStore(getSql()),
  health: () => new PgHealthReader(getSql()),
  healthSnapshots: () => new PgHealthSnapshots(getSql()),
  projects: () => new PgProjectRepository(getSql()),
  agentPrompts: () => new PgAgentPromptRepository(getSql()),
  entities: () => new PgEntityRepository(getSql()),
  usage: () => new PgUsageRepository(getSql()),
  auth: () => new PgAuthRepository(getSql()),
  email: () => getEmailSender(),
  digestSubscriptions: () => new PgDigestSubscriptions(getSql()),
  sessionCaptures: () => new PgSessionCaptureRepository(getSql()),
  codeIndex: () => new PgCodeIndex(getSql(), getEmbeddingProvider()),
  sourceTree: () => new FsSourceTree(),
};

let replacements: Partial<CorePorts> = {};

export function configureCore(ports: Partial<CorePorts>): void {
  replacements = { ...replacements, ...ports };
}

export function resetCore(): void {
  replacements = {};
}

// Built on every call rather than cached: `closeSql()` drops the client, and an adapter kept from
// before would hold the closed one.
export function port<P extends keyof CorePorts>(name: P): CorePorts[P] {
  return replacements[name] ?? defaults[name]();
}
