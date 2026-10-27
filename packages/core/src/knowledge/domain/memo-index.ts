import type { Memo, MemoType } from "./memo.js";

export interface SearchHit {
  entry: Memo;
  /** Relevance in [0,1]. In hybrid it is normalised RRF; in vector search, cosine. */
  score: number;
}

export interface MemoSearchScope {
  projectId?: string | null;
  /** Only when there is no `projectId`. An EMPTY array restricts to zero rows: fail-closed. */
  projectIds?: string[] | null;
  type?: MemoType;
  excludeId?: string;
  includeArchived?: boolean;
  asOf?: Date;
  includeHistorical?: boolean;
}

export interface MemoIndex {
  index(memoId: string, text: string): Promise<void>;
  indexMany(
    items: { memoId: string; text: string }[],
    opts?: { batchSize?: number; onProgress?: (done: number) => void },
  ): Promise<void>;
  similar(queryText: string, scope: MemoSearchScope, limit: number): Promise<SearchHit[]>;
  /** The nearest to a memo already indexed, from its stored vector: nothing is embedded again. */
  neighboursOf(memoId: string, scope: MemoSearchScope, limit: number): Promise<SearchHit[]>;
  hybrid(queryText: string, scope: MemoSearchScope, limit: number): Promise<SearchHit[]>;
  /** Cosine similarity of a memo to each of the others, from the stored vectors; one without a vector is absent. */
  similarities(memoId: string, otherIds: string[]): Promise<Map<string, number>>;
}
