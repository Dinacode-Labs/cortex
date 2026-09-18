/**
 * Hooks in JSON form: Claude Code (`~/.claude/settings.json`) and Codex
 * (`~/.codex/hooks.json`) use the SAME shape, so the merge lives here once.
 *
 *   hooks: { <Event>: [ { matcher?, hooks: [ { type, command, timeout? } ] } ] }
 *
 * The delicate part is that the file belongs to the user: it may hold hooks of their own and
 * hooks of ours from an earlier version (the legacy `pnpm -C <repo> cortex hook-context`,
 * which no longer works because it assumes a monorepo clone). A Cortex hook is recognised by
 * its marker, and when an old one is found it is REPLACED in place rather than another being
 * added: duplicating them means distilling the same session twice.
 */

export type HookKind = "context" | "capture";

export interface HookDef {
  event: string;
  kind: HookKind;
  command: string;
  matcher?: string;
  timeout?: number;
}

/** How a Cortex hook is recognised, including the syntaxes we have already retired. */
export const HOOK_MARKERS: Record<HookKind, string[]> = {
  context: ["hook-context", "hook:context"],
  capture: ["hook-capture", "hook:capture"],
};

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
}
export interface HooksHolder {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
}

const isCortex = (cmd: unknown, kind: HookKind): boolean =>
  typeof cmd === "string" && HOOK_MARKERS[kind].some((m) => cmd.includes(m));

const anyCortex = (cmd: unknown): boolean => isCortex(cmd, "context") || isCortex(cmd, "capture");

/** Removes groups and events left empty, so no junk is left behind in the file. */
function prune(obj: HooksHolder): void {
  if (!obj.hooks) return;
  for (const [event, groups] of Object.entries(obj.hooks)) {
    const kept = groups.filter((g) => (g.hooks?.length ?? 0) > 0);
    if (kept.length === 0) delete obj.hooks[event];
    else obj.hooks[event] = kept;
  }
  if (Object.keys(obj.hooks).length === 0) delete obj.hooks;
}

export interface MergeResult {
  changed: string[];
  /** Hooks from an earlier version that were rewritten in place. */
  replacedLegacy: string[];
}

/** Installs (or updates) Cortex's hooks, leaving the user's untouched. */
export function mergeHooks(obj: HooksHolder, defs: HookDef[]): MergeResult {
  const res: MergeResult = { changed: [], replacedLegacy: [] };
  obj.hooks ??= {};
  for (const def of defs) {
    const groups = (obj.hooks[def.event] ??= []);
    const mine = groups.flatMap((g) => g.hooks ?? []).filter((h) => isCortex(h.command, def.kind));
    if (mine.length === 0) {
      const entry: HookEntry = { type: "command", command: def.command };
      if (def.timeout) entry.timeout = def.timeout;
      groups.push(def.matcher ? { matcher: def.matcher, hooks: [entry] } : { hooks: [entry] });
      res.changed.push(`${def.event} → ${def.command}`);
      continue;
    }
    const stale = mine.filter((h) => h.command !== def.command);
    if (stale.length === 0) continue;
    for (const h of stale) {
      res.replacedLegacy.push(`${def.event}: ${h.command}`);
      h.command = def.command;
      h.type ??= "command";
      if (def.timeout) h.timeout = def.timeout;
    }
    res.changed.push(`${def.event} → updated (${stale.length} hook${stale.length > 1 ? "s" : ""} from an older version)`);
  }
  prune(obj);
  return res;
}

/** Removes every Cortex hook and leaves the rest as it was. */
export function removeHooks(obj: HooksHolder): { changed: string[] } {
  const changed: string[] = [];
  if (!obj.hooks) return { changed };
  for (const [event, groups] of Object.entries(obj.hooks)) {
    for (const g of groups) {
      const before = g.hooks?.length ?? 0;
      g.hooks = (g.hooks ?? []).filter((h) => !anyCortex(h.command));
      if (g.hooks.length !== before) changed.push(`${event}: ${before - g.hooks.length} hook(s) de Cortex fuera`);
    }
  }
  prune(obj);
  return { changed };
}

/** Is any Cortex hook installed? (used by `--status`). */
export function hasCortexHooks(obj: HooksHolder): boolean {
  return Object.values(obj.hooks ?? {}).some((groups) => groups.some((g) => (g.hooks ?? []).some((h) => anyCortex(h.command))));
}
