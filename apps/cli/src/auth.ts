import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

/**
 * `cortex auth` — login por email + OTP contra el servidor de Cortex. Guarda el token en
 * `~/.cortex/credentials` (chmod 600). Lo usarán hooks/CLI/MCP para firmar las escrituras
 * (atribución) cuando migren a la API HTTP.
 *
 *   cortex auth login [--email x] [--server url]
 *   cortex auth status | whoami
 *   cortex auth logout
 */
const CREDS_DIR = join(homedir(), ".cortex");
const CREDS_FILE = join(CREDS_DIR, "credentials");
const DEFAULT_SERVER = process.env.CORTEX_SERVER_URL || "http://localhost:8787";

interface Creds {
  server: string;
  token: string;
  email: string;
}

function readCreds(): Creds | null {
  if (!existsSync(CREDS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CREDS_FILE, "utf8")) as Creds;
  } catch {
    return null;
  }
}

function writeCreds(c: Creds): void {
  mkdirSync(CREDS_DIR, { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify(c, null, 2) + "\n");
  chmodSync(CREDS_FILE, 0o600);
}

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function login(): Promise<void> {
  const server = argOf("--server") || DEFAULT_SERVER;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = (argOf("--email") || (await rl.question("Email corporativo: "))).trim();
    const req = await postJson(`${server}/auth/request`, { email });
    if (!req.ok) {
      console.error(`✗ ${req.data.error ?? "No se pudo solicitar el código."}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Te hemos enviado un código a ${email} (caduca en unos minutos).`);
    const code = (await rl.question("Código: ")).trim();
    const ver = await postJson(`${server}/auth/verify`, { email, code });
    if (!ver.ok) {
      console.error(`✗ ${ver.data.error ?? "Código no válido."}`);
      process.exitCode = 1;
      return;
    }
    writeCreds({ server, token: ver.data.token, email: ver.data.user.email });
    console.log(`✓ Sesión iniciada como ${ver.data.user.email}.\n  → ${CREDS_FILE}`);
  } finally {
    rl.close();
  }
}

async function status(): Promise<void> {
  const creds = readCreds();
  if (!creds) {
    console.log("No autenticado. Ejecuta: cortex auth login");
    return;
  }
  const res = await fetch(`${creds.server}/auth/me`, { headers: { authorization: `Bearer ${creds.token}` } });
  if (!res.ok) {
    console.log(`Sesión inválida o caducada (${creds.email}). Ejecuta: cortex auth login`);
    process.exitCode = 1;
    return;
  }
  const data = (await res.json()) as { user: { email: string } };
  console.log(`Autenticado como ${data.user.email}  ·  servidor ${creds.server}`);
}

async function logout(): Promise<void> {
  const creds = readCreds();
  if (creds) {
    await fetch(`${creds.server}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${creds.token}` } }).catch(() => {});
    rmSync(CREDS_FILE, { force: true });
  }
  console.log("Sesión cerrada.");
}

async function main(): Promise<void> {
  const sub = process.argv[2];
  if (sub === "login") await login();
  else if (sub === "status" || sub === "whoami") await status();
  else if (sub === "logout") await logout();
  else console.log("Uso: cortex auth <login|status|logout>");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(process.exitCode ?? 0));
