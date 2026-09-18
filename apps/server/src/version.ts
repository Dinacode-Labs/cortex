import { createRequire } from "node:module";

/**
 * The server's version and the minimum client version it accepts.
 *
 * It is read from the root `package.json` at runtime rather than baked into the build: that
 * way an image cannot end up announcing a version that is not its own. The depth is the same
 * from `src/` and from `dist/` (both hang off `apps/server/`).
 */
const require = createRequire(import.meta.url);

function readVersion(): string {
  try {
    return (require("../../../package.json") as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
}

export const SERVER_VERSION = readVersion();

/**
 * The oldest CLI THIS server accepts (ADR-0062). It is the only number that can block: below
 * it, the CLI refuses to write (reading keeps working).
 *
 * Who raises it: **the PR that breaks compatibility** with a shipped CLI (a route or field
 * removed or renamed, a schema tightened), by bumping the default here to the version it ships
 * in and saying so in the CHANGELOG. Not on every release, which is why the default is so low.
 * The environment variable is an operator override for one deployment, not where breaks are
 * recorded. `SERVER_VERSION`, by contrast, is informational only: the CLI uses it to warn that
 * a new version exists, or that the server has fallen behind.
 */
export const MIN_CLIENT_VERSION = process.env.CORTEX_MIN_CLIENT_VERSION?.trim() || "0.1.0";
