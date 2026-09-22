/**
 * The CLI's version, injected by tsup at bundle time (`define`). In development, under `tsx`,
 * that constant does not exist: hence the fallback, which also distinguishes "running from the
 * repo" from "installed from npm".
 */
declare const __CORTEX_VERSION__: string | undefined;

export const CLI_VERSION: string = typeof __CORTEX_VERSION__ === "string" ? __CORTEX_VERSION__ : "dev";

/**
 * A semver's three numbers, ignoring the `v` prefix and any prerelease or build suffix
 * (`0.1.12-beta.1` -> 0.1.12). More precision is not needed: Cortex's versions are `x.y.z` and
 * what gets compared is "is it ahead or behind?".
 */
function parts(version: string): [number, number, number] {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/**
 * Compares two versions: negative when `a` < `b`, 0 when equal, positive when `a` > `b`.
 * `dev` (the CLI run from the repo, or a server with no `package.json`) is not comparable: it
 * is treated as equal to anything, so it never blocks and never warns.
 */
export function compareVersions(a: string, b: string): number {
  if (a === "dev" || b === "dev") return 0;
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

export function isOlderThan(version: string, min: string): boolean {
  return compareVersions(version, min) < 0;
}
