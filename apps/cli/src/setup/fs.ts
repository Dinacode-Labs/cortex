import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GENERATED_MARKER, type SetupCtx } from "./types.js";

/**
 * Writing other people's configuration files.
 *
 * `cortex setup` touches configurations the user wrote by hand and that cost money if lost, so:
 * a backup BEFORE the first change to each file, and nothing is deleted unless it carries our
 * marker.
 */

/** Files already backed up in this run (one copy per run, not per write). */
const backedUp = new WeakMap<SetupCtx, Set<string>>();

function stamp(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Copies `file` to `file.bak-<date>` the first time it is written to. Files we generate
 * ourselves are not backed up: the copy is only worth anything when a person wrote what is
 * inside.
 */
export function backupOnce(ctx: SetupCtx, file: string): string | null {
  if (!existsSync(file)) return null;
  if ((readText(file) ?? "").includes(GENERATED_MARKER)) return null;
  let seen = backedUp.get(ctx);
  if (!seen) backedUp.set(ctx, (seen = new Set()));
  if (seen.has(file)) return null;
  seen.add(file);
  const dest = `${file}.bak-${stamp(ctx.now())}`;
  if (!ctx.dryRun) copyFileSync(file, dest);
  return dest;
}

export function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Writes only when the content changes. `cortex setup` is meant to be run many times, and
 * rewriting an identical file pollutes the report and leaves backups that protect nothing.
 */
export function writeIfChanged(ctx: SetupCtx, file: string, content: string): boolean {
  if (readText(file) === content) return false;
  writeText(ctx, file, content);
  return true;
}

export function writeText(ctx: SetupCtx, file: string, content: string): void {
  backupOnce(ctx, file);
  if (ctx.dryRun) return;
  mkdirSync(dirname(file), { recursive: true });
  // The previous installation left symlinks into the cloned repo. Writing through one would
  // fail if it is broken (ENOENT opening the target) and, if it is NOT broken, would be worse:
  // it would write inside somebody else's repo. The link is removed and a real file written.
  try {
    if (lstatSync(file).isSymbolicLink()) rmSync(file, { force: true });
  } catch {
    /* it does not exist: nothing to undo */
  }
  writeFileSync(file, content);
}

/** Somebody else's configuration JSON. When it does not parse it returns `null`: it is never overwritten blind. */
export function readJson<T = Record<string, unknown>>(file: string): T | null | undefined {
  const raw = readText(file);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null; // it exists but is broken
  }
}

export function writeJson(ctx: SetupCtx, file: string, value: unknown): void {
  writeText(ctx, file, JSON.stringify(value, null, 2) + "\n");
}

/** Deletes a file only when we generated it (it carries the marker). */
export function removeIfGenerated(ctx: SetupCtx, file: string): boolean {
  const raw = readText(file);
  if (raw === null || !raw.includes(GENERATED_MARKER)) return false;
  if (!ctx.dryRun) rmSync(file, { force: true });
  return true;
}

/** `~/something` for the messages: absolute HOME paths add nothing. */
export function tilde(ctx: SetupCtx, file: string): string {
  return file.startsWith(ctx.home) ? `~${file.slice(ctx.home.length)}` : file;
}

export const homeFile = (ctx: SetupCtx, ...parts: string[]): string => join(ctx.home, ...parts);
