/**
 * Reciprocal Rank Fusion: merges a vector list and a lexical (FTS) one by adding
 * `1/(K+rank+1)` per position in each list. The vector branch additionally keeps the cosine
 * (`1 - distance`). It returns the list ordered by RRF desc and cut to `limit`. A PURE
 * function (no database): each caller then decides how to derive its final score from
 * `rrf`/`cosine` (hybrid normalises, for instance; code search does not).
 */
export function rrfFuse(
  vecRows: { id: string; distance?: number | string }[],
  ftsRows: { id: string }[],
  limit: number,
  K = 60,
): { id: string; rrf: number; cosine?: number }[] {
  const acc = new Map<string, { rrf: number; cosine?: number }>();
  vecRows.forEach((r, i) => {
    const cur = acc.get(r.id) ?? { rrf: 0 };
    cur.rrf += 1 / (K + i + 1);
    cur.cosine = 1 - Number(r.distance);
    acc.set(r.id, cur);
  });
  ftsRows.forEach((r, i) => {
    const cur = acc.get(r.id) ?? { rrf: 0 };
    cur.rrf += 1 / (K + i + 1);
    acc.set(r.id, cur);
  });
  return [...acc.entries()]
    .sort((a, b) => b[1].rrf - a[1].rrf)
    .slice(0, limit)
    .map(([id, s]) => ({ id, rrf: s.rrf, cosine: s.cosine }));
}
