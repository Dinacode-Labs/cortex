import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * ÚNICA lectura/escritura de `~/.cortex/credentials` (las escribe `cortex auth login`).
 * Antes había 4 copias del parser (cli/auth, cli/ui, core/api-client, core/link) con
 * 3 interfaces Creds distintas.
 *
 * `CORTEX_HOME` sustituye a `~` para que los tests y las pruebas end-to-end puedan usar
 * una sesión aparte sin pisar la del usuario (ADR-0025).
 */
export interface Credentials {
  server: string;
  token: string;
  email: string;
}

/** Raíz donde vive `.cortex/`: `CORTEX_HOME` si está definida, si no el home del usuario. */
export function credentialsHome(): string {
  return process.env.CORTEX_HOME?.trim() || homedir();
}

export function credentialsPath(): string {
  return join(credentialsHome(), ".cortex", "credentials");
}

export function readCredentials(): Credentials | null {
  const f = credentialsPath();
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Credentials;
  } catch {
    return null;
  }
}

export function writeCredentials(c: Credentials): void {
  const f = credentialsPath();
  mkdirSync(join(credentialsHome(), ".cortex"), { recursive: true });
  writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
  chmodSync(f, 0o600);
}

export function clearCredentials(): void {
  rmSync(credentialsPath(), { force: true });
}
