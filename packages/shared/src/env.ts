import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Carga el .env de la raíz del repo una sola vez, sin dependencias externas
 * (Node ≥ 20.6 trae process.loadEnvFile). No pisa variables ya definidas en el
 * entorno real. Los entrypoints (migrate, seed, mcp-server) deben llamarla al
 * arrancar.
 */
let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  // packages/shared/src -> raíz del repo
  const envPath = resolve(import.meta.dirname, "../../../.env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
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
