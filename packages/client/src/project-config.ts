import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setActiveServer } from "./api-client.js";

/** The contents of a `.cortex.json` (a pointer to a Cortex project). */
export interface CortexLink {
  /** The project's slug in Cortex (the preferred linking key). */
  slug?: string;
  /** The project's name (legacy / back-compat). */
  project?: string;
  /** Explicit opt-out: this repo does NOT use Cortex. */
  ignore?: boolean;
  /**
   * Which server this repo belongs to. Absent = the default one, which is the case for
   * almost everybody.
   *
   * The server is a property of the REPO, not a global mode that gets switched on and off
   * (ADR-0033). Someone working for several organisations does not have to remember which
   * one they are in: they decided that when they linked the folder.
   */
  server?: string;
}

/** Reads the NEAREST `.cortex.json` walking up from cwd (the nearest one wins). */
export function readCortexLink(cwd: string): CortexLink | null {
  let dir = cwd;
  for (let i = 0; i < 15; i++) {
    const f = join(dir, ".cortex.json");
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, "utf8")) as CortexLink;
      } catch {
        /* invalid json -> keep walking up */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Path of a directory's `.cortex.json` (without walking up). */
export function cortexLinkPath(dir: string): string {
  return join(dir, ".cortex.json");
}

/** Writes a directory's `.cortex.json` and returns the path written. */
export function writeCortexLink(dir: string, link: CortexLink): string {
  const f = cortexLinkPath(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(f, JSON.stringify(link, null, 2) + "\n");
  return f;
}

/**
 * Resolves the repo's link and leaves the process talking to ITS server.
 *
 * The hooks and the commands that operate on a folder call it before touching the API. It is
 * what guarantees one repo's capture never lands on another's server: whoever writes always
 * knows the `cwd`, and the `cwd` knows its server.
 */
export function useProjectServer(cwd: string): CortexLink | null {
  const link = readCortexLink(cwd);
  setActiveServer(link?.server ?? null);
  return link;
}
