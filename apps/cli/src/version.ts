/**
 * Versión del CLI, inyectada por tsup al empaquetar (`define`). En desarrollo, con `tsx`, esa
 * constante no existe: de ahí el fallback, que también sirve para distinguir «ejecutando
 * desde el repo» de «instalado desde npm».
 */
declare const __CORTEX_VERSION__: string | undefined;

export const CLI_VERSION: string = typeof __CORTEX_VERSION__ === "string" ? __CORTEX_VERSION__ : "dev";

/** Compara dos versiones semver sencillas. `dev` nunca se considera antigua. */
export function isOlderThan(version: string, min: string): boolean {
  if (version === "dev") return false;
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) < (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) > (b[i] ?? 0)) return false;
  }
  return false;
}
