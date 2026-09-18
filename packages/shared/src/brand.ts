import { existsSync, readFileSync } from "node:fs";
import { getEnv } from "./env.js";

/**
 * The product's visible branding. It exists so that whoever deploys Cortex does not inherit
 * the branding of whoever wrote it: name and logo are operator configuration, not code
 * constants (ADR-0013, revised).
 *
 * Used in the web <title> and header, the login screen, the subject of the OTP email, the
 * context injected into agents and the CLI help.
 */

/** Visible brand name. Defaults to "Cortex". */
export function getBrandName(): string {
  return getEnv("CORTEX_BRAND_NAME", "").trim() || "Cortex";
}

let logoCache: string | null | undefined;

/**
 * The logo SVG, or null if there is none (the web then falls back to a text wordmark).
 * Sources: `CORTEX_BRAND_LOGO_SVG` (inline) or `CORTEX_BRAND_LOGO_FILE` (a path).
 *
 * Security note: the web inserts this with `raw()`, so it is checked to look like an SVG
 * and to carry no `<script>`. This is OPERATOR configuration (trusted by definition:
 * whoever can set the env var already controls the process), not user input; the check is
 * a net against a silly mistake, not a sanitiser.
 */
export function getBrandLogoSvg(): string | null {
  if (logoCache !== undefined) return logoCache;
  const inline = getEnv("CORTEX_BRAND_LOGO_SVG", "").trim();
  const file = getEnv("CORTEX_BRAND_LOGO_FILE", "").trim();
  let svg = inline;
  if (!svg && file) {
    try {
      svg = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
    } catch {
      svg = ""; // unreadable path: degrade to the wordmark rather than break the page
    }
  }
  logoCache = svg && /^<svg[\s>]/i.test(svg) && !/<script/i.test(svg) ? svg : null;
  return logoCache;
}

/** Drops the cached logo. Tests only. */
export function resetBrandCache(): void {
  logoCache = undefined;
}
