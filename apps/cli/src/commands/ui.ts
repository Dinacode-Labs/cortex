import { spawn } from "node:child_process";
import { resolveServidor } from "../servidor.js";
import { platform } from "node:os";
import { getClientConfig, readCredentials } from "@cortex/client";

/**
 * `cortex ui` — abre la UI web YA AUTENTICADA. Pide al servidor un **ticket de un solo
 * uso** (autenticado con el token de la CLI) y abre /auth/cli?ticket=… La web lo canjea
 * por una sesión propia. Así el token de larga vida del CLI nunca viaja en la URL.
 */
export async function run(args: string[] = []): Promise<void> {
  const elegido = await resolveServidor(args, { verbo: "open" });
  if (!elegido) {
    process.exitCode = 1;
    return;
  }
  // La dirección de la web la dice el SERVIDOR (`/client-config`), no una variable con un
  // default de desarrollo. Antes `ui` se autenticaba correctamente contra el servidor bueno y
  // luego abría el navegador en localhost, que es de los fallos más desconcertantes que hay:
  // todo parece ir bien y la ventana que se abre no existe.
  const cfg = await getClientConfig(elegido);
  const WEB = process.env.CORTEX_WEB_URL?.trim() || cfg?.webUrl || "http://localhost:8080";

  const c = readCredentials(elegido);
  if (!c?.token) {
    console.error("Not signed in. Run: cortex auth login");
    process.exit(1);
  }
  const server = elegido;
  let ticket: string;
  try {
    const res = await fetch(`${server}/auth/ui-ticket`, { method: "POST", headers: { authorization: `Bearer ${c.token}` } });
    const data = (await res.json().catch(() => ({}))) as { ticket?: string; error?: string };
    if (!res.ok || !data.ticket) {
      console.error(`Could not open an authenticated session: ${data.error ?? "server " + res.status}. Try cortex auth login, and check the server is running.`);
      process.exit(1);
    }
    ticket = data.ticket;
  } catch (e) {
    console.error(`Could not reach the server (${server}): ${(e as Error).message}`);
    process.exit(1);
  }

  const url = `${WEB}/auth/cli?ticket=${encodeURIComponent(ticket)}`;
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const argsDelNavegador = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(opener, argsDelNavegador, { detached: true, stdio: "ignore" });
    child.on("error", () => console.log(`Open it yourself:\n  ${url}`));
    child.unref();
    console.log(`Opening the Cortex UI, already signed in → ${WEB}`);
  } catch {
    console.log(`Open it yourself:\n  ${url}`);
  }
}
