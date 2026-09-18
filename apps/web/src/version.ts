import { createRequire } from "node:module";

/**
 * Suffix for the static assets' URLs.
 *
 * `/styles.css` is served with neither `Cache-Control` nor `ETag` -- only `Last-Modified` -- so
 * the browser applies its own heuristic and keeps the old copy without asking. The result is
 * that anyone who had visited before sees the new interface with the old styles, half painted,
 * and from outside it looks as though the deploy never landed. Pinning the version into the URL
 * turns every release into a different file, which is the cheap, dependency-free way to do it.
 */
function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // The same depth from `src/` and from `dist/`.
    return (require("../package.json") as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
}

export const ASSET_VERSION = packageVersion();
