import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * `cortex ui` — abre la UI web de Cortex YA AUTENTICADA, usando el token de la CLI
 * (~/.cortex/credentials). Así el OTP solo se usa para instalar/autenticar la CLI; la UI
 * se abre con un handshake (/auth/cli?token=…) que deja una cookie de sesión.
 */
const CREDS = join(homedir(), ".cortex", "credentials");
const WEB = process.env.CORTEX_WEB_URL || "http://localhost:8080";

function token(): string | null {
  if (!existsSync(CREDS)) return null;
  try {
    return (JSON.parse(readFileSync(CREDS, "utf8")) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

const t = token();
if (!t) {
  console.error("No autenticado. Ejecuta primero: cortex auth login");
  process.exit(1);
}

const url = `${WEB}/auth/cli?token=${encodeURIComponent(t)}`;
const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
try {
  const child = spawn(opener, args, { detached: true, stdio: "ignore" });
  child.on("error", () => console.log(`Ábrela manualmente:\n  ${url}`));
  child.unref();
  console.log(`Abriendo la UI de Cortex autenticada → ${WEB}`);
} catch {
  console.log(`Ábrela manualmente:\n  ${url}`);
}
