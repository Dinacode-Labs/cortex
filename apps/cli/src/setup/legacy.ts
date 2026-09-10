import { existsSync, lstatSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readText, tilde } from "./fs.js";
import type { SetupCtx, SetupReport } from "./types.js";

/**
 * Limpieza de la instalación anterior a ADR-0025: un clon del monorepo en
 * `~/.dinacode-cortex` y un shim `~/.local/bin/cortex` que ejecutaba `tsx` sobre él.
 *
 * Mientras el shim siga en el PATH gana al `cortex` de npm (o al revés, según el orden), y el
 * dev acaba usando un binario distinto del que cree. Por eso se borra, y no se avisa y ya.
 * El clon, en cambio, solo se informa: puede tener un `.env` con claves y ramas sin subir,
 * así que borrarlo es cosa del usuario.
 */

const LEGACY_CLONE = ".dinacode-cortex";

export function legacyShimPath(ctx: SetupCtx): string {
  return join(ctx.home, ".local/bin/cortex");
}

/** ¿Es el shim viejo (tsx sobre un clon) y no un binario legítimo? */
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
    report.changed.push(`shim antiguo eliminado (${tilde(ctx, file)}): lo sustituye el \`cortex\` de npm`);
  }
  const clone = join(ctx.home, LEGACY_CLONE);
  if (existsSync(clone)) {
    report.warnings.push(
      `queda el clon antiguo en ${tilde(ctx, clone)} — ya no hace falta, pero bórralo tú: puede tener un .env con claves o ramas sin subir.`,
    );
  }
}
