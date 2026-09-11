import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GENERATED_MARKER, type SetupCtx } from "./types.js";

/**
 * Escritura de ficheros de configuración ajenos.
 *
 * `cortex setup` toca configuraciones que el usuario ha escrito a mano y que valen dinero si
 * se pierden, así que: copia de seguridad ANTES del primer cambio de cada fichero, y solo se
 * borra lo que llevamos nuestra marca.
 */

/** Ficheros ya respaldados en esta ejecución (una copia por ejecución, no por escritura). */
const backedUp = new WeakMap<SetupCtx, Set<string>>();

function stamp(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Copia `file` a `file.bak-<fecha>` la primera vez que se escribe en él. Los ficheros que
 * generamos nosotros no se respaldan: la copia solo tiene valor si lo que hay dentro lo
 * escribió una persona.
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
 * Escribe solo si el contenido cambia. `cortex setup` está pensado para ejecutarse muchas
 * veces, y reescribir un fichero idéntico ensucia el informe y deja copias de seguridad que
 * no protegen de nada.
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
  // La instalación anterior dejaba symlinks al repo clonado. Escribir a través de uno
  // fallaría si está roto (ENOENT al abrir el destino) y, si NO lo está, sería peor: se
  // escribiría dentro del repo de otro. Se quita el enlace y se escribe un fichero de verdad.
  try {
    if (lstatSync(file).isSymbolicLink()) rmSync(file, { force: true });
  } catch {
    /* no existe: nada que deshacer */
  }
  writeFileSync(file, content);
}

/** JSON de configuración ajena. Si no parsea devuelve `null`: nunca se sobreescribe a ciegas. */
export function readJson<T = Record<string, unknown>>(file: string): T | null | undefined {
  const raw = readText(file);
  if (raw === null) return undefined; // no existe
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null; // existe pero está roto
  }
}

export function writeJson(ctx: SetupCtx, file: string, value: unknown): void {
  writeText(ctx, file, JSON.stringify(value, null, 2) + "\n");
}

/** Borra un fichero solo si lo generamos nosotros (lleva la marca). */
export function removeIfGenerated(ctx: SetupCtx, file: string): boolean {
  const raw = readText(file);
  if (raw === null || !raw.includes(GENERATED_MARKER)) return false;
  if (!ctx.dryRun) rmSync(file, { force: true });
  return true;
}

/** `~/algo` para los mensajes: las rutas absolutas del HOME no aportan nada. */
export function tilde(ctx: SetupCtx, file: string): string {
  return file.startsWith(ctx.home) ? `~${file.slice(ctx.home.length)}` : file;
}

export const homeFile = (ctx: SetupCtx, ...parts: string[]): string => join(ctx.home, ...parts);
