import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * ÚNICA lectura/escritura de `~/.cortex/credentials` (las escribe `cortex auth login`).
 * Antes había 4 copias del parser (cli/auth, cli/ui, core/api-client, core/link) con
 * 3 interfaces Creds distintas. Módulo con I/O en shared: excepción pragmática
 * documentada en docs/decisions.md (shared es el único paquete visible desde core,
 * agents y apps a la vez).
 */
export interface Credentials {
  server: string;
  token: string;
  email: string;
}

export function credentialsPath(): string {
  return join(homedir(), ".cortex", "credentials");
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
  mkdirSync(join(homedir(), ".cortex"), { recursive: true });
  writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
  chmodSync(f, 0o600);
}

export function clearCredentials(): void {
  rmSync(credentialsPath(), { force: true });
}
