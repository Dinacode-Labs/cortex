import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Carga variables desde un .env en la raíz del repo si existe, sin dependencias
 * externas (Node ≥ 20.6 trae process.loadEnvFile). No pisa variables ya definidas
 * en el entorno real.
 */
let loaded = false;
function loadEnvOnce(): void {
  if (loaded) return;
  loaded = true;
  // packages/database/src -> raíz del repo
  const envPath = resolve(import.meta.dirname, "../../../.env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

export function getDatabaseUrl(): string {
  loadEnvOnce();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL no está definida. Copia .env.example a .env o exporta la variable.",
    );
  }
  return url;
}
