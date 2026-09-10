/**
 * Hooks en formato JSON: lo usan Claude Code (`~/.claude/settings.json`) y Codex
 * (`~/.codex/hooks.json`) con la MISMA forma, así que el merge vive aquí una sola vez.
 *
 *   hooks: { <Evento>: [ { matcher?, hooks: [ { type, command, timeout? } ] } ] }
 *
 * La parte delicada es que el fichero es del usuario: puede tener hooks suyos y hooks
 * nuestros de una versión anterior (el legado `pnpm -C <repo> cortex hook-context`, que ya no
 * funciona porque asume un clon del monorepo). Un hook de Cortex se reconoce por su marcador,
 * y cuando se encuentra uno viejo se SUSTITUYE en su sitio en vez de añadir otro: duplicarlos
 * significa destilar dos veces la misma sesión.
 */

export type HookKind = "context" | "capture";

export interface HookDef {
  event: string;
  kind: HookKind;
  command: string;
  matcher?: string;
  timeout?: number;
}

/** Cómo se reconoce un hook de Cortex, incluidas las sintaxis que ya hemos retirado. */
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

/** Quita grupos y eventos que se hayan quedado vacíos, para no dejar basura en el fichero. */
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
  /** Hooks de una versión anterior que se han reescrito en su sitio. */
  replacedLegacy: string[];
}

/** Instala (o actualiza) los hooks de Cortex dejando intactos los del usuario. */
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
    res.changed.push(`${def.event} → actualizado (${stale.length} hook${stale.length > 1 ? "s" : ""} de una versión anterior)`);
  }
  prune(obj);
  return res;
}

/** Saca todos los hooks de Cortex y deja el resto como estaba. */
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

/** ¿Hay algún hook de Cortex instalado? (lo usa `--status`). */
export function hasCortexHooks(obj: HooksHolder): boolean {
  return Object.values(obj.hooks ?? {}).some((groups) => groups.some((g) => (g.hooks ?? []).some((h) => anyCortex(h.command))));
}
