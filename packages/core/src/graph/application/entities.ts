import type { Entity, EntityType } from "@cortex/shared";
import { port } from "../../composition.js";
import type { RelationInput } from "../domain/entity-repository.js";

/**
 * Finds or creates an entity by (type, canonical name). The basis of entity resolution
 * (section 12.4): different spellings of the same name converge on the canonical one.
 */
export async function resolveEntity(name: string, type: EntityType): Promise<Entity> {
  // A project is not "resolved": it is created with a slug and an owner in `createProject`.
  // The ghosts of #135 were born here (26 in one real installation), and the database no
  // longer accepts them.
  if (type === "project") throw new Error(`resolveEntity: "${name}" is a project; use createProject.`);
  return port("entities").resolve(name, type);
}

export async function linkEntryToEntity(memoId: string, entityId: string): Promise<void> {
  return port("entities").linkMemo(memoId, entityId);
}

/**
 * Creates a relation between two entities/entries unless an equivalent current one exists,
 * through the partial UNIQUE index the adapter relies on.
 */
export async function relate(args: RelationInput): Promise<void> {
  return port("entities").relate(args);
}
