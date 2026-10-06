import type { ApiResult, ProjectPurgeScope } from "@cortex/client";
import { contextEntryStatus, contextEntryTypeInput, type PurgeEntriesResponse, type PurgeProjectPreview } from "@cortex/shared";

export const PURGE_CONFIRMATION = "purge";

export const ENTRY_PURGE_UNSUPPORTED = "This server cannot purge entries yet: it needs updating.";
export const PROJECT_PURGE_UNSUPPORTED = "This server cannot purge a whole project yet: it needs updating.";

export function isPurgeConfirmed(answer: string): boolean {
  return answer.trim().toLowerCase() === PURGE_CONFIRMATION;
}

/** The slug exactly, case included: it is what a person reads back, not a word they recall. */
export function isSlugConfirmed(answer: string, slug: string): boolean {
  return answer.trim() === slug;
}

export interface PurgeOutcome {
  ok: boolean;
  message: string;
}

export function describePurgeFailure(res: ApiResult<unknown>, outdatedServer: string): string {
  const data = (res.data ?? {}) as { error?: string; missing?: string[] };
  if (res.status === 404 && !data.error) return outdatedServer;
  if (res.status === 404 && data.missing?.length) return `Not found, so nothing was purged: ${data.missing.join(", ")}`;
  return data.error ?? `HTTP ${res.status}`;
}

export function describePurgeResult(
  res: ApiResult<PurgeEntriesResponse | { error?: string; missing?: string[] }>,
  outdatedServer = ENTRY_PURGE_UNSUPPORTED,
): PurgeOutcome {
  if (!res.ok) return { ok: false, message: describePurgeFailure(res, outdatedServer) };
  const purged = (res.data as Partial<PurgeEntriesResponse>).purged ?? [];
  return { ok: true, message: `purged ${purged.length} ${purged.length === 1 ? "entry" : "entries"}` };
}

export interface PurgeScopeFlags {
  all: boolean;
  from?: string;
  to?: string;
  type?: string;
  status?: string;
}

const DAY_MS = 86_400_000;

function startOfUtcDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day ? null : date;
}

/**
 * `--from` and `--to` are whole UTC days, both included, as the Memory screen prints them.
 * `null` means no scope was asked for: the ids on the command line are what goes.
 */
export function parsePurgeScope(flags: PurgeScopeFlags): { scope: ProjectPurgeScope } | { error: string } | null {
  const dated = flags.from !== undefined || flags.to !== undefined;
  if (!flags.all && !dated) {
    return flags.type || flags.status ? { error: "--type and --status narrow --all, --from or --to: add one of them." } : null;
  }
  const from = flags.from === undefined ? undefined : startOfUtcDay(flags.from);
  const lastDay = flags.to === undefined ? undefined : startOfUtcDay(flags.to);
  if (from === null || lastDay === null) return { error: "--from and --to take a day, as YYYY-MM-DD (UTC)." };
  const to = lastDay ? new Date(lastDay.getTime() + DAY_MS) : undefined;
  if (from && to && from >= to) return { error: "--from cannot be after --to." };

  const type = flags.type === undefined ? undefined : contextEntryTypeInput.safeParse(flags.type);
  if (type && !type.success) return { error: `Unknown type "${flags.type}".` };
  const status = flags.status === undefined ? undefined : contextEntryStatus.safeParse(flags.status);
  if (status && !status.success) return { error: `Unknown status "${flags.status}". One of: ${contextEntryStatus.options.join(", ")}.` };

  return {
    scope: {
      ...(type ? { type: type.data } : {}),
      ...(status ? { status: status.data } : {}),
      ...(dated ? { periods: [{ field: "created", from: from?.toISOString(), to: to?.toISOString() }] } : {}),
    },
  };
}

export function describePurgePreview(preview: PurgeProjectPreview, slug: string): string {
  const noun = preview.count === 1 ? "entry" : "entries";
  const span =
    preview.oldest && preview.newest
      ? `, added between ${preview.oldest.slice(0, 10)} and ${preview.newest.slice(0, 10)}`
      : "";
  const byType = Object.entries(preview.byType)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([type, n]) => `${type} ${n}`)
    .join(" · ");
  return [
    `About to purge ${preview.count} ${noun} of "${slug}" for good${span}:`,
    `  ${byType}`,
    "Only entries saved to this project itself go; a child project keeps its own.",
    "It cannot be undone: no search, pack or screen will return them again.",
  ].join("\n");
}
