import type { ApiResult } from "@cortex/client";
import type { PurgeEntriesResponse } from "@cortex/shared";

export const PURGE_CONFIRMATION = "purge";

export function isPurgeConfirmed(answer: string): boolean {
  return answer.trim().toLowerCase() === PURGE_CONFIRMATION;
}

export interface PurgeOutcome {
  ok: boolean;
  message: string;
}

export function describePurgeResult(res: ApiResult<PurgeEntriesResponse | { error?: string; missing?: string[] }>): PurgeOutcome {
  const data = (res.data ?? {}) as Partial<PurgeEntriesResponse> & { error?: string; missing?: string[] };
  if (res.ok) {
    const purged = data.purged ?? [];
    return { ok: true, message: `purged ${purged.length} ${purged.length === 1 ? "entry" : "entries"}` };
  }
  if (res.status === 404 && !data.error) {
    return { ok: false, message: "This server cannot purge entries yet: it needs updating." };
  }
  if (res.status === 404 && data.missing?.length) {
    return { ok: false, message: `Not found, so nothing was purged: ${data.missing.join(", ")}` };
  }
  return { ok: false, message: data.error ?? `HTTP ${res.status}` };
}
