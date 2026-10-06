import { getSql } from "@cortex/database";
import type { EntityRepository } from "./graph/domain/entity-repository.js";
import { PgEntityRepository } from "./graph/infrastructure/entity.repository.js";
import type { MemoRepository } from "./knowledge/domain/memo-repository.js";
import { PgMemoRepository } from "./knowledge/infrastructure/memo.repository.js";
import type { ProjectRepository } from "./projects/domain/project-repository.js";
import { PgProjectRepository } from "./projects/infrastructure/project.repository.js";

export interface CorePorts {
  memos: MemoRepository;
  projects: ProjectRepository;
  entities: EntityRepository;
}

const defaults: { [P in keyof CorePorts]: () => CorePorts[P] } = {
  memos: () => new PgMemoRepository(getSql()),
  projects: () => new PgProjectRepository(getSql()),
  entities: () => new PgEntityRepository(getSql()),
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
