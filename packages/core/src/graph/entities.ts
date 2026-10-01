import type { Sql } from "@cortex/database";
import type { Entity, EntityType } from "@cortex/shared";
import { PgEntityRepository } from "./infrastructure/entity.repository.js";
import type { RelationInput } from "./domain/entity-repository.js";

/**
 * Finds or creates an entity by (type, canonical name). The basis of entity resolution
 * (section 12.4): different spellings of the same name converge on the canonical one.
 */
export async function resolveEntity(
  sql: Sql,
  name: string,
  type: EntityType,
): Promise<Entity> {
  // A project is not "resolved": it is created with a slug and an owner in `createProject`.
  // The ghosts of #135 were born here (26 in one real installation), and the database no
  // longer accepts them.
  if (type === "project") throw new Error(`resolveEntity: "${name}" is a project; use createProject.`);
  return new PgEntityRepository(sql).resolve(name, type);
}

export async function linkEntryToEntity(
  sql: Sql,
  memoId: string,
  entityId: string,
): Promise<void> {
  return new PgEntityRepository(sql).linkMemo(memoId, entityId);
}

/**
 * Creates a relation between two entities/entries unless an equivalent current one exists,
 * through the partial UNIQUE index the adapter relies on.
 */
export async function relate(sql: Sql, args: RelationInput): Promise<void> {
  return new PgEntityRepository(sql).relate(args);
}
