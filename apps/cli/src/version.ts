/**
 * Versión del CLI, inyectada por tsup al empaquetar (`define`). En desarrollo, con `tsx`, esa
 * constante no existe: de ahí el fallback, que también sirve para distinguir «ejecutando
 * desde el repo» de «instalado desde npm».
 */
declare const __CORTEX_VERSION__: string | undefined;

export const CLI_VERSION: string = typeof __CORTEX_VERSION__ === "string" ? __CORTEX_VERSION__ : "dev";

/**
 * Los tres números de un semver, ignorando el prefijo `v` y cualquier sufijo de prerelease o
 * build (`0.1.12-beta.1` → 0.1.12). Con más precisión no hace falta: las versiones de Cortex
 * son `x.y.z` y lo que se compara es «¿va por delante o por detrás?».
 */
function parts(version: string): [number, number, number] {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/**
 * Compara dos versiones: negativo si `a` < `b`, 0 si iguales, positivo si `a` > `b`.
 * `dev` (el CLI ejecutado desde el repo, o un servidor sin `package.json`) no es comparable:
 * se trata como igual a cualquier cosa, para que nunca bloquee ni avise.
 */
export function compareVersions(a: string, b: string): number {
  if (a === "dev" || b === "dev") return 0;
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

/** `version` es anterior a `min`. `dev` nunca se considera antigua. */
export function isOlderThan(version: string, min: string): boolean {
  return compareVersions(version, min) < 0;
}
