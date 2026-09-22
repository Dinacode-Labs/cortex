import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The ONLY place that reads/writes `~/.cortex/credentials` (written by `cortex auth login`).
 * There used to be 4 copies of the parser (cli/auth, cli/ui, core/api-client, core/link) with
 * 3 different Creds interfaces.
 *
 * The file holds **one session per server**, not a single one (ADR-0033). Someone working for
 * several organisations has one Cortex for each, and the repo says which one it belongs to.
 * With a single global session you would have to switch it by hand, which is precisely how
 * one client's knowledge gets sent to another's server.
 *
 * `CORTEX_HOME` replaces `~` so that tests and end-to-end runs can use a separate session
 * without stepping on the user's own (ADR-0025).
 */
export interface Credentials {
  server: string;
  token: string;
  email: string;
}

/** On-disk format. The previous one was a bare `Credentials`; it is still read (see `parse`). */
interface CredentialsFile {
  version: 2;
  /** Key = the server URL, normalised with no trailing slash. */
  servers: Record<string, { token: string; email: string }>;
  /** Which server to talk to when the repo does not say. The first one added. */
  default?: string;
}

/** Without this, `https://x/api` and `https://x/api/` would be two different sessions. */
export function normalizeServer(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Root where `.cortex/` lives: `CORTEX_HOME` when set, otherwise the user's home. */
export function credentialsHome(): string {
  return process.env.CORTEX_HOME?.trim() || homedir();
}

export function credentialsPath(): string {
  return join(credentialsHome(), ".cortex", "credentials");
}

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
  // Previous format: a single {server, token, email} object. It is read as one session, so
  // whoever upgrades the CLI does not have to sign in again.
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
 * The session for a given server, or the default one when none is asked for.
 *
 * It returns `null` when asked for a server that has not been signed into: that is correct,
 * and the caller should read it as "not signed in THERE", not as "not signed in".
 */
export function readCredentials(server?: string): Credentials | null {
  const file = parse();
  if (!file) return null;
  const key = server ? normalizeServer(server) : (file.default ?? Object.keys(file.servers)[0]);
  if (!key) return null;
  const entry = file.servers[key];
  return entry ? { server: key, token: entry.token, email: entry.email } : null;
}

/** Every stored session, the default one first. */
export function listCredentials(): Credentials[] {
  const file = parse();
  if (!file) return [];
  const keys = Object.keys(file.servers).sort((a, b) => (a === file.default ? -1 : b === file.default ? 1 : 0));
  return keys.map((k) => ({ server: k, token: file.servers[k]!.token, email: file.servers[k]!.email }));
}

export function defaultServer(): string | null {
  const file = parse();
  return file?.default ?? (file ? (Object.keys(file.servers)[0] ?? null) : null);
}

/** Adds or updates a server's session. The first one in becomes the default. */
export function writeCredentials(c: Credentials): void {
  const key = normalizeServer(c.server);
  const file = parse() ?? { version: 2 as const, servers: {} };
  file.servers[key] = { token: c.token, email: c.email };
  file.default ??= key;
  save(file);
}

/** Changes the default server. Returns false when there is no session for it. */
export function setDefaultServer(server: string): boolean {
  const key = normalizeServer(server);
  const file = parse();
  if (!file?.servers[key]) return false;
  file.default = key;
  save(file);
  return true;
}

/**
 * Signs out of one server, or of all of them when none is named. When the default one is
 * removed, the next takes over: leaving a `default` pointing at nothing would fail every call
 * with a "not signed in" that explains nothing.
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
  const left = Object.keys(file.servers);
  if (left.length === 0) {
    rmSync(credentialsPath(), { force: true });
    return;
  }
  if (file.default === key) file.default = left[0];
  save(file);
}
