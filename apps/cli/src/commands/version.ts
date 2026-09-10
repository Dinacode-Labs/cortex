import { getClientConfig, getServerVersion, readCredentials } from "@cortex/client";
import { CLI_VERSION } from "../version.js";

/**
 * `cortex version` — qué versión tienes tú y qué versión tiene el servidor.
 *
 * Las dos importan: el servidor declara una versión mínima de cliente, y cuando alguien dice
 * «a mí no me funciona» lo primero es saber si está tres versiones por detrás.
 */
export async function run(): Promise<void> {
  console.log(`cortex ${CLI_VERSION}`);
  console.log(`node ${process.versions.node} · ${process.platform}-${process.arch}`);

  const creds = readCredentials();
  if (!creds) return;
  const [version, cfg] = await Promise.all([getServerVersion(), getClientConfig(creds.server)]);
  if (!version && !cfg) {
    console.log(`servidor ${creds.server} — no responde`);
    return;
  }
  console.log(`servidor ${creds.server} · ${version ?? cfg?.version ?? "?"}`);
  if (cfg?.minClientVersion) console.log(`versión mínima de cliente: ${cfg.minClientVersion}`);
}
