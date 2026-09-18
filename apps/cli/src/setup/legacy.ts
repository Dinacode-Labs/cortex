import { existsSync, lstatSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readText, tilde } from "./fs.js";
import type { SetupCtx, SetupReport } from "./types.js";

/**
 * Cleaning up the pre-ADR-0025 installation: a monorepo clone in `~/.dinacode-cortex` and a
 * `~/.local/bin/cortex` shim that ran `tsx` over it.
 *
 * While that shim stays on the PATH it beats npm's `cortex` (or the other way round, depending
 * on the order), and the dev ends up using a different binary from the one they think. That is
 * why it is deleted rather than merely warned about. The clone, by contrast, is only reported:
 * it may hold a `.env` with keys and unpushed branches, so deleting it is the user's call.
 */

const LEGACY_CLONE = ".dinacode-cortex";

export function legacyShimPath(ctx: SetupCtx): string {
  return join(ctx.home, ".local/bin/cortex");
}

/** Is this the old shim (tsx over a clone) rather than a legitimate binary? */
export function detectLegacyShim(ctx: SetupCtx): boolean {
  const file = legacyShimPath(ctx);
  if (!existsSync(file)) return false;
  try {
    if (lstatSync(file).isSymbolicLink()) return readlinkSync(file).includes(LEGACY_CLONE);
  } catch {
    return false;
  }
  const body = readText(file) ?? "";
  return body.includes("tsx") && (body.includes("apps/cli/src/index.ts") || body.includes(LEGACY_CLONE));
}

export function cleanLegacy(ctx: SetupCtx, report: SetupReport): void {
  if (detectLegacyShim(ctx)) {
    const file = legacyShimPath(ctx);
    if (!ctx.dryRun) rmSync(file, { force: true });
    report.changed.push(`old shim removed (${tilde(ctx, file)}): the npm \`cortex\` replaces it`);
  }
  const clone = join(ctx.home, LEGACY_CLONE);
  if (existsSync(clone)) {
    report.warnings.push(
      `the old clone is still at ${tilde(ctx, clone)}. It is no longer needed, but delete it yourself: it may hold a .env with keys, or unpushed branches.`,
    );
  }
}
