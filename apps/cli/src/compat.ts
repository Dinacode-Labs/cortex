import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiBase, apiRequest, credentialsHome, normalizeServer, readCredentials } from "@cortex/client";
import type { ClientConfig } from "@cortex/shared";
import { CLI_VERSION, compareVersions } from "./version.js";

/**
 * Compatibilidad entre este CLI y el servidor al que habla (ADR-0062).
 *
 * El CLI lo actualiza cada persona desde npm; el servidor, un operador, a su ritmo. Son dos
 * relojes distintos y no se atan: el contrato es la API HTTP, no el número de versión. Lo que
 * sí se hace es **mirar los dos números que el servidor publica en `/client-config`** y sacar
 * de ahí una de cuatro conclusiones:
 *
 *   - `blocked`        el CLI está por debajo de `minClientVersion`: los comandos que ESCRIBEN
 *                      se niegan, para no dejar algo a medias. Los de lectura siguen.
 *   - `cli-behind`     el servidor va por delante: hay CLI nuevo en npm, se sugiere `upgrade`.
 *   - `server-behind`  el CLI va por delante: lo nuevo que traiga no estará hasta que quien
 *                      opera el servidor lo actualice. Es el caso que nadie veía.
 *   - `ok` / `unknown` iguales, o no se pudo saber (servidor caído o tan viejo que no publica
 *                      versión). No saber NUNCA bloquea: la petición real ya dirá lo que pase.
 *
 * El aviso es pasivo: una consulta cada 24 h por servidor, cacheada en `~/.cortex/`, y **una
 * línea a stderr** al terminar un comando interactivo. Los hooks y `cortex mcp` no pasan por
 * aquí jamás: ahí stdout es protocolo y un byte de más rompe la sesión del agente. Hay un
 * test que lo comprueba.
 */

const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
/** Si el servidor no respondió, se reintenta antes: una caída de un minuto no debería callar el aviso un día. */
const FAILURE_TTL_MS = 60 * 60 * 1000;
/** Corto a propósito: esto corre al final de cada comando y no puede añadir segundos de espera. */
const TIMEOUT_MS = 3000;

export type Compat =
  | { kind: "unknown"; server: string }
  | { kind: "ok"; server: string; serverVersion: string }
  | { kind: "cli-behind"; server: string; serverVersion: string }
  | { kind: "server-behind"; server: string; serverVersion: string }
  | { kind: "blocked"; server: string; serverVersion: string; minClientVersion: string };

interface Entry {
  /** Cuándo se consultó (ISO). Sin `version` significa que la consulta falló. */
  at: string;
  version?: string;
  minClientVersion?: string;
  /** Cuándo se enseñó el aviso por última vez, para no repetirlo en cada comando. */
  notifiedAt?: string;
}

interface CacheFile {
  version: 1;
  servers: Record<string, Entry>;
}

export function compatCachePath(): string {
  return join(credentialsHome(), ".cortex", "version-check.json");
}

function readCache(): CacheFile {
  try {
    const raw = JSON.parse(readFileSync(compatCachePath(), "utf8")) as Partial<CacheFile>;
    if (raw && raw.version === 1 && raw.servers && typeof raw.servers === "object") return raw as CacheFile;
  } catch {
    /* no existe o está corrupto: se empieza de cero */
  }
  return { version: 1, servers: {} };
}

function writeCache(cache: CacheFile): void {
  try {
    mkdirSync(join(credentialsHome(), ".cortex"), { recursive: true });
    writeFileSync(compatCachePath(), JSON.stringify(cache, null, 2) + "\n");
  } catch {
    /* un disco de solo lectura no puede romper un comando por un aviso */
  }
}

/**
 * La conclusión, a partir de lo que anuncia el servidor. Separado de la red y del disco para
 * poder probarlo con una tabla de casos. Un campo ausente es un servidor anterior a ese campo,
 * no un error: se degrada a «no se sabe» (regla de escritura del ADR-0062).
 */
export function classify(server: string, cli: string, cfg: Partial<Pick<ClientConfig, "version" | "minClientVersion">> | null): Compat {
  if (!cfg || !cfg.version || cli === "dev" || cfg.version === "dev") return { kind: "unknown", server };
  const serverVersion = cfg.version;
  if (cfg.minClientVersion && compareVersions(cli, cfg.minClientVersion) < 0) {
    return { kind: "blocked", server, serverVersion, minClientVersion: cfg.minClientVersion };
  }
  const cmp = compareVersions(cli, serverVersion);
  if (cmp < 0) return { kind: "cli-behind", server, serverVersion };
  if (cmp > 0) return { kind: "server-behind", server, serverVersion };
  return { kind: "ok", server, serverVersion };
}

async function fetchConfig(server: string): Promise<Pick<ClientConfig, "version" | "minClientVersion"> | null> {
  const res = await apiRequest<Partial<ClientConfig>>("GET", "/client-config", undefined, { auth: false, baseUrl: server, timeoutMs: TIMEOUT_MS });
  // 404 = servidor anterior a `/client-config`; status 0 = no respondió. Los dos son «no se sabe».
  if (!res.ok || !res.data || typeof res.data.version !== "string") return null;
  return { version: res.data.version, minClientVersion: typeof res.data.minClientVersion === "string" ? res.data.minClientVersion : "" };
}

export interface CompatOptions {
  /** Consultar al servidor aunque la caché sea reciente. Lo usan los comandos que escriben. */
  fresh?: boolean;
  now?: () => number;
}

/**
 * Qué relación hay entre este CLI y `server`, consultándolo como mucho una vez cada 24 h.
 * `fetched` dice si esta llamada fue al servidor o vino de la caché.
 */
export async function serverCompat(server: string, opts: CompatOptions = {}): Promise<{ compat: Compat; fetched: boolean }> {
  const key = normalizeServer(server);
  const now = opts.now?.() ?? Date.now();
  const cache = readCache();
  const prev = cache.servers[key];
  const age = prev ? now - Date.parse(prev.at) : Infinity;
  const ttl = prev?.version ? CHECK_TTL_MS : FAILURE_TTL_MS;
  if (prev && !opts.fresh && Number.isFinite(age) && age >= 0 && age < ttl) {
    return { compat: classify(key, CLI_VERSION, prev.version ? prev : null), fetched: false };
  }
  const cfg = await fetchConfig(key);
  cache.servers[key] = { ...(prev?.notifiedAt ? { notifiedAt: prev.notifiedAt } : {}), at: new Date(now).toISOString(), ...(cfg ?? {}) };
  writeCache(cache);
  return { compat: classify(key, CLI_VERSION, cfg), fetched: true };
}

/** La línea que se enseña por cada situación. `null` cuando no hay nada que decir. */
export function noticeLine(c: Compat): string | null {
  switch (c.kind) {
    case "blocked":
      return `Cortex ${CLI_VERSION} is below the minimum this server accepts (${c.minClientVersion}): writing is disabled · cortex upgrade`;
    case "cli-behind":
      return `Cortex ${CLI_VERSION} → ${c.serverVersion} · cortex upgrade`;
    case "server-behind":
      return `Cortex: this CLI is ${CLI_VERSION} but the server at ${c.server} runs ${c.serverVersion}. Newer features stay off until whoever operates it updates it.`;
    default:
      return null;
  }
}

/** El mensaje con el que falla un comando de escritura cuando el CLI está por debajo del mínimo. */
export function blockedMessage(c: Extract<Compat, { kind: "blocked" }>): string {
  return (
    `this CLI is ${CLI_VERSION} and the server at ${c.server} accepts ${c.minClientVersion} or newer. ` +
    `Writing is disabled so nothing is saved half-way; reading still works. Update with: cortex upgrade`
  );
}

function checksDisabled(): boolean {
  return CLI_VERSION === "dev" || Boolean(process.env.CORTEX_NO_VERSION_CHECK?.trim());
}

export interface NoticeOptions extends CompatOptions {
  /** Si hay una persona delante. Por defecto, `process.stdout.isTTY`. */
  tty?: boolean;
  /** Dónde escribir. Por defecto, stderr. */
  write?: (line: string) => void;
}

/**
 * El aviso pasivo: lo llama el dispatcher al terminar un comando interactivo. Una línea a
 * stderr, como mucho una vez cada 24 h por servidor, y solo si hay una terminal delante: en un
 * script, en CI o en una tubería no dice nada. Nunca lanza.
 */
export async function printVersionNotice(opts: NoticeOptions = {}): Promise<void> {
  try {
    const tty = opts.tty ?? Boolean(process.stdout.isTTY);
    if (!tty || checksDisabled() || process.env.CI) return;
    const server = normalizeServer(apiBase());
    // Sin sesión en ese servidor no hay nada que comparar, y puede ni ser un Cortex.
    if (!readCredentials(server)) return;
    const { compat } = await serverCompat(server, opts);
    const line = noticeLine(compat);
    if (!line) return;
    const now = opts.now?.() ?? Date.now();
    const cache = readCache();
    const entry = cache.servers[server];
    if (entry?.notifiedAt && now - Date.parse(entry.notifiedAt) < CHECK_TTL_MS) return;
    (opts.write ?? ((l) => process.stderr.write(l + "\n")))(line);
    if (entry) {
      entry.notifiedAt = new Date(now).toISOString();
      writeCache(cache);
    }
  } catch {
    /* un aviso no puede hacer fallar el comando que acaba de funcionar */
  }
}

/**
 * Para los comandos que ESCRIBEN: el motivo por el que no deben hacerlo, o `null`. Consulta al
 * servidor en fresco (una petición corta) porque un `minClientVersion` recién subido tiene que
 * frenar hoy, no mañana. Si el servidor no responde, no bloquea: la escritura fallará sola con
 * su propio mensaje. Llamar DESPUÉS de `useProjectServer(cwd)`, que es quien fija el servidor.
 */
export async function writeBlocker(opts: CompatOptions = {}): Promise<string | null> {
  if (checksDisabled()) return null;
  try {
    const { compat } = await serverCompat(apiBase(), { ...opts, fresh: true });
    return compat.kind === "blocked" ? blockedMessage(compat) : null;
  } catch {
    return null;
  }
}

/** Igual que `writeBlocker`, pero lanza: para comandos que no formatean sus propios errores. */
export async function requireCompatibleServer(opts: CompatOptions = {}): Promise<void> {
  const why = await writeBlocker(opts);
  if (why) throw new Error(why);
}
