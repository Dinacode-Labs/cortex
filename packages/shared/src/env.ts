import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Carga un `.env` una sola vez, sin dependencias externas (Node ≥ 20.6 trae
 * `process.loadEnvFile`). No pisa variables ya definidas en el entorno real.
 * Los entrypoints (migrate, seed, servidores) la llaman al arrancar.
 *
 * Busca, en este orden: `CORTEX_ENV_FILE`, el `.env` del directorio desde el que se lanzó
 * el comando (`INIT_CWD`, que pnpm fija a la raíz del monorepo aunque `--filter` cambie el
 * cwd) y el `.env` del cwd. **No** se resuelve relativo a este fichero: eso ataba la
 * función a vivir en `packages/shared/src` y se rompía al compilar a `dist/` o al
 * empaquetar (era un hallazgo conocido del refactor).
 */
let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (typeof process.loadEnvFile !== "function") return;
  const candidates = [
    process.env.CORTEX_ENV_FILE,
    process.env.INIT_CWD ? resolve(process.env.INIT_CWD, ".env") : undefined,
    resolve(process.cwd(), ".env"),
  ].filter((p): p is string => Boolean(p));
  const hit = candidates.find((p) => existsSync(p));
  if (hit) process.loadEnvFile(hit);
}

/** Devuelve una variable de entorno o lanza si falta. */
export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`La variable de entorno ${name} es obligatoria y no está definida.`);
  }
  return value;
}

/** Devuelve una variable de entorno o un valor por defecto. */
export function getEnv(name: string, fallback: string): string {
  loadEnv();
  return process.env[name] ?? fallback;
}

/**
 * Lee una env var numérica (int o float) con default. NaN → default.
 *
 * OJO comportamiento: `Number(process.env.X ?? "8")` con X="" da Number("")=0
 * (¡no 8!); getEnvNum trata ""→fallback y NaN→fallback, más correcto (mejora
 * deliberada). Ningún caller del repo depende del antiguo ""→0.
 */
export function getEnvNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}
