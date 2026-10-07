/**
 * Knowledge lint (Karpathy's "LLM Wiki" pattern + the loops of section 12): a per-project
 * health check that reports quality signals for curating the memory.
 *
 * Every signal looks ONLY at current entries (`valid_to IS NULL`) -- except
 * `staleHistorical`, which is precisely a count of the historical ones. Without that filter,
 * the lint kept reporting as "duplicates" the entries `reconcile` had already invalidated.
 */

export interface LintReport {
  project: string;
  totalEntries: number;
  /**
   * The `*Id`s are ENTRY ids, and they can be missing: one end of a contradiction may be an
   * entity, which has no page of its own. Without them the report was a list of titles that
   * led nowhere, and a finding you cannot open is a finding that gets ignored.
   */
  contradictions: { a: string; b: string; aId: string | null; bId: string | null }[];
  duplicates: { a: string; b: string; score: number; aId: string; bId: string }[];
  orphanEntities: { name: string; type: string }[];
  lowConfidence: number;
  staleHistorical: number;
  /**
   * Current entries nobody has ever looked at.
   *
   * It is the largest finding in almost any project and it showed up nowhere: in a real one,
   * **348 out of 348**. While nobody validates, status and confidence tell nothing apart, so
   * the pack cannot prioritise by reliability even though it knows how. This is not a bug in
   * the code -- this half of the loop belongs to people -- but keeping quiet does not help
   * either.
   */
  neverReviewed: number;
  gaps: { area: string; type: string; incidents: number }[];
}

/**
 * Cosine distances under which two current memos are likely duplicates. Across different types a
 * high similarity is usually legitimate (the incident that prompted a decision looks a lot like
 * the decision), so the bar stays high there. Within the same type it is looser, because that is
 * where the echo measured in a real project falls -- the same decision stored by the tool and
 * again by the session's distillation, 0.86-0.88. A signal for someone to look at, not a truth.
 */
export const DUPLICATE_DISTANCE = { sameType: 0.15, otherType: 0.12 } as const;

/** An area with this many incidents and no decision is a gap: things keep breaking and nobody decided anything. */
export const GAP_MIN_INCIDENTS = 2;

/**
 * What the last lint of a project found, kept so a project card can show it without linting: the
 * duplicate search compares every pair of the project's vectors, over ten seconds for 1,800 memos
 * (ADR-0089).
 */
export interface HealthSnapshot {
  contradictions: number;
  duplicates: number;
  checkedAt: Date;
}

export interface HealthSnapshots {
  record(projectId: string, found: Omit<HealthSnapshot, "checkedAt">): Promise<void>;
  latest(projectIds: string[]): Promise<Map<string, HealthSnapshot>>;
}

export interface HealthReader {
  currentCount(projectId: string): Promise<number>;
  contradictions(projectId: string, limit: number): Promise<LintReport["contradictions"]>;
  likelyDuplicates(
    projectId: string,
    distance: typeof DUPLICATE_DISTANCE,
    limit: number,
  ): Promise<LintReport["duplicates"]>;
  orphanEntities(projectId: string, limit: number): Promise<LintReport["orphanEntities"]>;
  neverReviewedCount(projectId: string): Promise<number>;
  lowConfidenceCount(projectId: string): Promise<number>;
  historicalCount(projectId: string): Promise<number>;
  incidentGaps(projectId: string, minIncidents: number, limit: number): Promise<LintReport["gaps"]>;
}
