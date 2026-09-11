import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * ÚNICA lectura/escritura de `~/.cortex/credentials` (las escribe `cortex auth login`).
 * Antes había 4 copias del parser (cli/auth, cli/ui, core/api-client, core/link) con
 * 3 interfaces Creds distintas.
 *
 * El fichero guarda **una sesión por servidor**, no una sola (ADR-0033). Quien trabaja para
 * varias organizaciones tiene un Cortex por cada una, y el repo dice a cuál pertenece. Con
 * una sola sesión global habría que ir cambiándola a mano, que es justo la forma de mandarle
 * el conocimiento de un cliente al servidor de otro.
 *
 * `CORTEX_HOME` sustituye a `~` para que los tests y las pruebas end-to-end puedan usar
 * una sesión aparte sin pisar la del usuario (ADR-0025).
 */
export interface Credentials {
  server: string;
  token: string;
  email: string;
}

/** Formato en disco. El de antes era `Credentials` a pelo; se sigue leyendo (ver `parse`). */
interface CredentialsFile {
  version: 2;
  /** Clave = URL del servidor, normalizada sin barra final. */
  servers: Record<string, { token: string; email: string }>;
  /** A qué servidor se habla cuando el repo no lo dice. El primero que se añade. */
  default?: string;
}

/** Sin esto, `https://x/api` y `https://x/api/` serían dos sesiones distintas. */
export function normalizeServer(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Raíz donde vive `.cortex/`: `CORTEX_HOME` si está definida, si no el home del usuario. */
export function credentialsHome(): string {
  return process.env.CORTEX_HOME?.trim() || homedir();
}

export function credentialsPath(): string {
  return join(credentialsHome(), ".cortex", "credentials");
}

/** Lee el fichero y lo normaliza al formato actual, venga como venga. */
function parse(): CredentialsFile | null {
  const f = credentialsPath();
  if (!existsSync(f)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
  const o = raw as Partial<CredentialsFile> & Partial<Credentials>;
  if (o && typeof o === "object" && o.servers) return o as CredentialsFile;
  // Formato anterior: un único objeto {server, token, email}. Se lee como una sola sesión,
  // así que quien actualice el CLI no tiene que volver a entrar.
  if (o?.server && o.token) {
    const key = normalizeServer(o.server);
    return { version: 2, servers: { [key]: { token: o.token, email: o.email ?? "" } }, default: key };
  }
  return null;
}

function save(file: CredentialsFile): void {
  const f = credentialsPath();
  mkdirSync(join(credentialsHome(), ".cortex"), { recursive: true });
  writeFileSync(f, JSON.stringify(file, null, 2) + "\n");
  chmodSync(f, 0o600);
}

/**
 * La sesión de un servidor concreto, o la de por defecto si no se pide ninguno.
 *
 * Devuelve `null` cuando se pide un servidor en el que no se ha entrado: es lo correcto, y
 * quien llama debe tratarlo como «no autenticado AHÍ», no como «no autenticado».
 */
export function readCredentials(server?: string): Credentials | null {
  const file = parse();
  if (!file) return null;
  const key = server ? normalizeServer(server) : (file.default ?? Object.keys(file.servers)[0]);
  if (!key) return null;
  const entry = file.servers[key];
  return entry ? { server: key, token: entry.token, email: entry.email } : null;
}

/** Todas las sesiones guardadas, la de por defecto primero. */
export function listCredentials(): Credentials[] {
  const file = parse();
  if (!file) return [];
  const keys = Object.keys(file.servers).sort((a, b) => (a === file.default ? -1 : b === file.default ? 1 : 0));
  return keys.map((k) => ({ server: k, token: file.servers[k]!.token, email: file.servers[k]!.email }));
}

/** ¿Cuál es el servidor por defecto? `null` si no hay ninguna sesión. */
export function defaultServer(): string | null {
  const file = parse();
  return file?.default ?? (file ? (Object.keys(file.servers)[0] ?? null) : null);
}

/** Añade o actualiza la sesión de un servidor. La primera que entra manda por defecto. */
export function writeCredentials(c: Credentials): void {
  const key = normalizeServer(c.server);
  const file = parse() ?? { version: 2 as const, servers: {} };
  file.servers[key] = { token: c.token, email: c.email };
  file.default ??= key;
  save(file);
}

/** Cambia el servidor por defecto. Devuelve false si no hay sesión en él. */
export function setDefaultServer(server: string): boolean {
  const key = normalizeServer(server);
  const file = parse();
  if (!file?.servers[key]) return false;
  file.default = key;
  save(file);
  return true;
}

/**
 * Cierra la sesión de un servidor, o todas si no se dice cuál. Al quitar la que era por
 * defecto, manda la siguiente: dejar un `default` apuntando a nada haría fallar cada llamada
 * con un «no autenticado» que no explica nada.
 */
export function clearCredentials(server?: string): void {
  if (!server) {
    rmSync(credentialsPath(), { force: true });
    return;
  }
  const key = normalizeServer(server);
  const file = parse();
  if (!file?.servers[key]) return;
  delete file.servers[key];
  const quedan = Object.keys(file.servers);
  if (quedan.length === 0) {
    rmSync(credentialsPath(), { force: true });
    return;
  }
  if (file.default === key) file.default = quedan[0];
  save(file);
}
