import { createInterface } from "node:readline/promises";
import { resolveServer } from "../server.js";
import { getEnv } from "@cortex/shared";
import {
  DEFAULT_SERVER_URL,
  clearCredentials,
  credentialsPath,
  defaultServer,
  listCredentials,
  normalizeServer,
  readCredentials,
  setDefaultServer,
  writeCredentials,
} from "@cortex/client";

/**
 * `cortex auth` -- sign in by email and code against a Cortex server. It stores the token in
 * `~/.cortex/credentials` (chmod 600), which is where the hooks, the CLI and the MCP take it
 * from to sign their writes.
 *
 * You can be signed in to **several servers at once** (ADR-0033): one Cortex per organisation,
 * and the repo decides which one it belongs to. Signing in to a new one does not sign you out
 * of the previous.
 *
 *   cortex auth login [--email x] [--server url]
 *   cortex auth status | whoami
 *   cortex auth logout [--server url] [--all]
 *   cortex auth use <url>            pick the default server
 */
function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function login(args: string[]): Promise<void> {
  // This used to go to the development server by default even when a session was already
  // configured, so anyone with two ended up authenticating against the wrong one.
  const server = await resolveServer(args, { verb: "sign in to", allowUnknown: true });
  if (!server) {
    process.exitCode = 1;
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Signing in to ${server}`);
    const email = (argOf("--email") || (await rl.question("Work email: "))).trim();
    const req = await postJson(`${server}/auth/request`, { email });
    if (!req.ok) {
      console.error(`✗ ${req.data.error ?? "Could not request the code."}`);
      process.exitCode = 1;
      return;
    }
    console.log(`We sent a code to ${email}. It expires in a few minutes.`);
    const code = (await rl.question("Code: ")).trim();
    const ver = await postJson(`${server}/auth/verify`, { email, code });
    if (!ver.ok) {
      console.error(`✗ ${ver.data.error ?? "That code is not valid."}`);
      process.exitCode = 1;
      return;
    }
    const primera = listCredentials().length === 0;
    writeCredentials({ server, token: ver.data.token, email: ver.data.user.email });
    console.log(`✓ Signed in as ${ver.data.user.email} on ${server}.\n  → ${credentialsPath()}`);
    if (!primera && defaultServer() !== server) {
      console.log(`\nThis is not your default server. Repositories reach it only if their .cortex.json says so:`);
      console.log(`  cortex link <slug> --server ${server}`);
      console.log(`To make it the default instead:  cortex auth use ${server}`);
    }
  } finally {
    rl.close();
  }
}

/** One session, checked against its own server. */
async function checkOne(c: { server: string; token: string; email: string }, esDefecto: boolean): Promise<boolean> {
  const marca = esDefecto ? " (default)" : "";
  try {
    const res = await fetch(`${c.server}/auth/me`, {
      headers: { authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.log(`  ✗ ${c.server}${marca} — session expired (${c.email}). Run: cortex auth login --server ${c.server}`);
      return false;
    }
    const data = (await res.json()) as { user: { email: string } };
    console.log(`  ✓ ${c.server}${marca} — ${data.user.email}`);
    return true;
  } catch (e) {
    console.log(`  ! ${c.server}${marca} — not responding (${(e as Error).message})`);
    return false;
  }
}

async function status(): Promise<void> {
  const all = listCredentials();
  if (all.length === 0) {
    console.log("Not signed in. Run: cortex auth login");
    return;
  }
  const def = defaultServer();
  console.log(all.length === 1 ? "Signed in to:" : `Signed in to ${all.length} servers:`);
  const results = await Promise.all(all.map((c) => checkOne(c, c.server === def)));
  if (results.some((ok) => !ok)) process.exitCode = 1;
}

async function logout(args: string[]): Promise<void> {
  const todos = args.includes("--all");
  let server: string | undefined;
  if (!todos) {
    const elegido = await resolveServer(args, { verb: "sign out of" });
    if (!elegido) {
      process.exitCode = 1;
      return;
    }
    server = elegido;
  }
  const objetivo = todos ? listCredentials() : [readCredentials(server)].filter((c) => c !== null);

  if (objetivo.length === 0) {
    console.log(server ? `Not signed in to ${server}.` : "Not signed in.");
    return;
  }
  for (const c of objetivo) {
    await fetch(`${c.server}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${c.token}` } }).catch(() => {});
    console.log(`Signed out of ${c.server}.`);
  }
  clearCredentials(todos ? undefined : objetivo[0]!.server);
}

function use(args: string[]): void {
  const server = args[1];
  if (!server) {
    console.error("Usage: cortex auth use <server-url>");
    process.exitCode = 1;
    return;
  }
  if (!setDefaultServer(server)) {
    console.error(`✗ Not signed in to ${server}. Run: cortex auth login --server ${server}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ Default server is now ${normalizeServer(server)}.`);
}

export async function run(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "login") await login(args);
  else if (sub === "status" || sub === "whoami") await status();
  else if (sub === "logout") await logout(args);
  else if (sub === "use") use(args);
  else console.log("Usage: cortex auth <login|status|logout|use>");
}
