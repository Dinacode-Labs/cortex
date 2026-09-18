import { spawn } from "node:child_process";
import { resolveServer } from "../server.js";
import { platform } from "node:os";
import { getClientConfig, readCredentials } from "@cortex/client";

/**
 * `cortex ui` -- opens the web UI ALREADY AUTHENTICATED. It asks the server for a **single-use
 * ticket** (authenticated with the CLI's token) and opens /auth/cli?ticket=... The web
 * exchanges it for a session of its own. That way the CLI's long-lived token never travels in
 * the URL.
 */
export async function run(args: string[] = []): Promise<void> {
  const elegido = await resolveServer(args, { verb: "open" });
  if (!elegido) {
    process.exitCode = 1;
    return;
  }
  // The web's address is stated by the SERVER (`/client-config`), not by a variable with a
  // development default. `ui` used to authenticate correctly against the right server and then
  // open the browser on localhost, which is one of the most baffling failures there is:
  // everything looks fine and the window that opens does not exist.
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
