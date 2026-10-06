import type { ConfidenceLevel, Entity, EntityType, RelationType } from "@cortex/shared";
import type { SharedEntity } from "./across.js";

export interface RelationInput {
  sourceId: string;
  sourceType: string;
  targetId: string;
  targetType: string;
  relationType: RelationType;
  confidence?: ConfidenceLevel;
}

/** A non-project entity, with what the resolution loop needs to group and rank it. */
export interface EntityNameRow {
  id: string;
  name: string;
  type: string;
}

/**
 * The port the graph module writes entities and edges through. It exists so the callers do not
 * build SQL inline (ADR-0076); the pg adapter lives in `infrastructure/`.
 */
export interface EntityRepository {
  /** Finds or creates an entity by (type, canonical name). */
  resolve(name: string, type: EntityType): Promise<Entity>;
  linkMemo(memoId: string, entityId: string): Promise<void>;
  relate(args: RelationInput): Promise<void>;
  listResolvable(): Promise<EntityNameRow[]>;
  linkCounts(): Promise<Map<string, number>>;
  /** Merges the variants into the canonical one, re-pointing links and relations. */
  mergeEntities(canonicalId: string, loserIds: string[]): Promise<void>;
  /** Drops self-relations and duplicate edges left after the merges. */
  normalizeRelations(): Promise<void>;
  sharedStack(projectIds: string[], types: EntityType[], limit: number): Promise<SharedEntity[]>;
}
