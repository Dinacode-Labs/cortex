import { getClientConfig, getServerVersion, readCredentials } from "@cortex/client";
import { classify, noticeLine } from "../compat.js";
import { CLI_VERSION } from "../version.js";
import { printSplash, wantsSplash } from "../splash.js";

/**
 * `cortex version` -- which version you have and which version the server has.
 *
 * Both matter: the server declares a minimum client version, and when somebody says "it does
 * not work for me" the first thing to know is whether they are three versions behind.
 */
export async function run(): Promise<void> {
  if (wantsSplash()) printSplash(CLI_VERSION);
  else console.log(`cortex ${CLI_VERSION}`);
  console.log(`node ${process.versions.node} · ${process.platform}-${process.arch}`);

  const creds = readCredentials();
  if (!creds) return;
  const [version, cfg] = await Promise.all([getServerVersion(), getClientConfig(creds.server)]);
  if (!version && !cfg) {
    console.log(`server ${creds.server} — not responding`);
    return;
  }
  console.log(`server ${creds.server} · ${version ?? cfg?.version ?? "?"}`);
  if (cfg?.minClientVersion) console.log(`minimum client version: ${cfg.minClientVersion}`);
  const line = noticeLine(classify(creds.server, CLI_VERSION, cfg ?? (version ? { version } : null)));
  if (line) console.log(line);
}
