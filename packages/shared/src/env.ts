import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads a `.env` once, with no external dependency (Node >= 20.6 ships
 * `process.loadEnvFile`). It never overwrites variables already set in the real
 * environment. Entrypoints (migrate, seed, servers) call it on startup.
 *
 * Lookup order: `CORTEX_ENV_FILE`, the `.env` of the directory the command was launched
 * from (`INIT_CWD`, which pnpm pins to the monorepo root even when `--filter` changes the
 * cwd) and the `.env` of the cwd. It is **not** resolved relative to this file: doing that
 * tied the function to living in `packages/shared/src` and broke once compiled to `dist/`
 * or bundled.
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

/** Returns an environment variable, or throws if it is missing. */
export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required and is not set.`);
  }
  return value;
}

/** Returns an environment variable, or a default value. */
export function getEnv(name: string, fallback: string): string {
  loadEnv();
  return process.env[name] ?? fallback;
}

/**
 * Reads a numeric env var (int or float) with a default. NaN -> default.
 *
 * Behaviour worth noting: `Number(process.env.X ?? "8")` with X="" yields Number("")=0
 * (not 8!); getEnvNum maps ""->fallback and NaN->fallback, which is more correct (a
 * deliberate improvement). No caller in the repo relies on the old ""->0.
 */
export function getEnvNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}
