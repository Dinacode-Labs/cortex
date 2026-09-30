import type { ConfidenceLevel, Entity, EntityType, RelationType } from "@cortex/shared";

export interface RelationInput {
  sourceId: string;
  sourceType: string;
  targetId: string;
  targetType: string;
  relationType: RelationType;
  confidence?: ConfidenceLevel;
}

/**
 * The port the graph module writes entities and edges through. It exists so the callers do not
 * build SQL inline (ADR-0076); the pg adapter lives in `infrastructure/`.
 */
export interface EntityRepository {
  /** Finds or creates an entity by (type, canonical name). */
  resolve(name: string, type: EntityType): Promise<Entity>;
  linkEntry(contextEntryId: string, entityId: string): Promise<void>;
  relate(args: RelationInput): Promise<void>;
}
