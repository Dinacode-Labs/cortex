import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiBase, apiRequest, credentialsHome, normalizeServer, readCredentials } from "@cortex/client";
import type { ClientConfig } from "@cortex/shared";
import { CLI_VERSION, compareVersions } from "./version.js";

/**
 * Compatibility between this CLI and the server it talks to (ADR-0062).
 *
 * Each person updates the CLI from npm; an operator updates the server, at their own pace. They
 * are two different clocks and they are not tied together: the contract is the HTTP API, not
 * the version number. What is done is **looking at the two numbers the server publishes in
 * `/client-config`** and drawing one of four conclusions from them:
 *
 *   - `blocked`        the CLI is below `minClientVersion`: the commands that WRITE refuse, so
 *                      nothing is left half-done. Read commands carry on.
 *   - `cli-behind`     the server is ahead: there is a newer CLI on npm, `upgrade` is suggested.
 *   - `server-behind`  the CLI is ahead: whatever new it brings will not be there until whoever
 *                      operates the server updates it. This is the case nobody could see.
 *   - `ok` / `unknown` equal, or it could not be determined (the server is down, or so old it
 *                      publishes no version). Not knowing NEVER blocks: the real request will
 *                      say what happens.
 *
 * The notice is passive: one query per server every 24 h, cached in `~/.cortex/`, and **one line
 * to stderr** when an interactive command finishes. The hooks and `cortex mcp` never come
 * through here: there, stdout is protocol and one extra byte breaks the agent's session. There
 * is a test that checks it.
 */

const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
/** When the server did not answer, it is retried sooner: a one-minute outage should not silence the notice for a day. */
const FAILURE_TTL_MS = 60 * 60 * 1000;
/** Deliberately short: this runs at the end of every command and cannot add seconds of waiting. */
const TIMEOUT_MS = 3000;

export type Compat =
  | { kind: "unknown"; server: string }
  | { kind: "ok"; server: string; serverVersion: string }
  | { kind: "cli-behind"; server: string; serverVersion: string }
  | { kind: "server-behind"; server: string; serverVersion: string }
  | { kind: "blocked"; server: string; serverVersion: string; minClientVersion: string };

interface Entry {
  /** When it was queried (ISO). With no `version` it means the query failed. */
  at: string;
  version?: string;
  minClientVersion?: string;
  /** When the notice was last shown, so it is not repeated on every command. */
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
    /* it does not exist or is corrupt: start from scratch */
  }
  return { version: 1, servers: {} };
}

function writeCache(cache: CacheFile): void {
  try {
    mkdirSync(join(credentialsHome(), ".cortex"), { recursive: true });
    writeFileSync(compatCachePath(), JSON.stringify(cache, null, 2) + "\n");
  } catch {
    /* a read-only disk must not break a command over a notice */
  }
}

/**
 * The conclusion, drawn from what the server announces. Separated from the network and the disk
 * so it can be tested with a table of cases. A missing field means a server predating that
 * field, not an error: it degrades to "unknown" (ADR-0062's writing rule).
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
  // 404 = a server predating `/client-config`; status 0 = it did not answer. Both mean "unknown".
  if (!res.ok || !res.data || typeof res.data.version !== "string") return null;
  return { version: res.data.version, minClientVersion: typeof res.data.minClientVersion === "string" ? res.data.minClientVersion : "" };
}

export interface CompatOptions {
  /** Query the server even when the cache is fresh. The commands that write use this. */
  fresh?: boolean;
  now?: () => number;
}

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
  tty?: boolean;
  write?: (line: string) => void;
}

export async function printVersionNotice(opts: NoticeOptions = {}): Promise<void> {
  try {
    const tty = opts.tty ?? Boolean(process.stdout.isTTY);
    if (!tty || checksDisabled() || process.env.CI) return;
    const server = normalizeServer(apiBase());
    // With no session on that server there is nothing to compare, and it may not even be a Cortex.
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
    /* a notice must not fail the command that just worked */
  }
}

/**
 * For the commands that WRITE: the reason they must not, or `null`. It queries the server fresh
 * (one short request) because a freshly raised `minClientVersion` has to stop things today, not
 * tomorrow. When the server does not answer it does not block: the write will fail on its own
 * with its own message. Call it AFTER `useProjectServer(cwd)`, which is what pins the server.
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

/** Like `writeBlocker`, but it throws: for commands that do not format their own errors. */
export async function requireCompatibleServer(opts: CompatOptions = {}): Promise<void> {
  const why = await writeBlocker(opts);
  if (why) throw new Error(why);
}
