import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import type { AuthRepository } from "./auth/domain/auth-repository.js";
import type { EmailSender } from "./auth/domain/email.js";
import { PgAuthRepository } from "./auth/infrastructure/auth.repository.js";
import { getEmailSender } from "./auth/infrastructure/email-senders.js";
import type { EntityRepository } from "./graph/domain/entity-repository.js";
import { PgEntityRepository } from "./graph/infrastructure/entity.repository.js";
import type { MemoRepository } from "./knowledge/domain/memo-repository.js";
import type { MemoIndex } from "./knowledge/domain/memo-index.js";
import { PgMemoIndex } from "./knowledge/infrastructure/memo.index.js";
import type { UsageRepository } from "./observability/domain/usage.js";
import { PgUsageRepository } from "./observability/infrastructure/usage.repository.js";
import { PgMemoRepository } from "./knowledge/infrastructure/memo.repository.js";
import type { ProjectRepository } from "./projects/domain/project-repository.js";
import { PgProjectRepository } from "./projects/infrastructure/project.repository.js";

export interface CorePorts {
  memos: MemoRepository;
  memoIndex: MemoIndex;
  projects: ProjectRepository;
  entities: EntityRepository;
  usage: UsageRepository;
  auth: AuthRepository;
  email: EmailSender;
}

const defaults: { [P in keyof CorePorts]: () => CorePorts[P] } = {
  memos: () => new PgMemoRepository(getSql()),
  memoIndex: () => new PgMemoIndex(getSql(), getEmbeddingProvider()),
  projects: () => new PgProjectRepository(getSql()),
  entities: () => new PgEntityRepository(getSql()),
  usage: () => new PgUsageRepository(getSql()),
  auth: () => new PgAuthRepository(getSql()),
  email: () => getEmailSender(),
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
