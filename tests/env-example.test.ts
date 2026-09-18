import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Keeping the configuration template honest.
 *
 * A `.env.example` goes stale silently: somebody adds a `getEnv("CORTEX_WHATEVER", ...)` and
 * the variable exists, works, and nobody knows about it but whoever wrote that line. It
 * happened with seven at once. And the other way round: one gets documented that the code no
 * longer reads, and whoever sets it waits for an effect that never comes.
 *
 * This compares the two lists. It is not exhaustive -- a variable read through a template
 * (`CORTEX_MODEL_${role}`) cannot be detected this way -- but it covers the normal case.
 */
const ROOT = resolve(import.meta.dirname, "..");
const PLANTILLAS = ["/.env.example", "/deploy/.env.example"].map((f) => readFileSync(ROOT + f, "utf8")).join("\n");

/** Environment variables that are not Cortex's: the system's, node's or CI's. */
const FOREIGN = /^(NODE_ENV|HOME|PATH|PWD|INIT_CWD|CI|TERM|USER|SHELL|LANG|TMPDIR|APPDATA|LOCALAPPDATA|COREPACK|PNPM|XDG|GITHUB|CLAUDE|npm)/;

/**
 * Deprecated names the code still accepts and the template deliberately does **not** offer.
 *
 * They keep working so nobody's months-old `.env` breaks, and they warn on the console when
 * used. But a template is what you should write today, not a record of what something used to
 * be called: that lives in the CHANGELOG and in the ADR that changed it. Offering them here
 * would invite new configurations with dead names.
 */
const DEPRECATED = new Set([
  "NAN_API_KEY", "NAN_BASE_URL", "NAN_LLM_MODEL", "NAN_EMBEDDING_MODEL", "NAN_EMBEDDING_DIM",
  "BREVO_SENDER", "BREVO_SENDER_NAME",
]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const READ = new Set<string>();
for (const f of [...sources(join(ROOT, "packages")), ...sources(join(ROOT, "apps"))]) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:process\.env\.([A-Z][A-Z0-9_]{2,})|getEnv(?:Num|Bool)?\("([A-Z][A-Z0-9_]{2,})"|requireEnv\("([A-Z][A-Z0-9_]{2,})")/g)) {
    const v = m[1] ?? m[2] ?? m[3]!;
    if (!FOREIGN.test(v) && !DEPRECATED.has(v)) READ.add(v);
  }
}

describe("the configuration template", () => {
  it("finds variables to look at (otherwise the test is worthless)", () => {
    expect(READ.size).toBeGreaterThan(40);
  });

  it("every variable the code reads is in some template", () => {
    const orphans = [...READ].filter((v) => !PLANTILLAS.includes(v)).sort();
    expect(orphans, "they exist, they work and nobody knows about them").toEqual([]);
  });

  it("the template offers no deprecated names", () => {
    const offered = [...DEPRECATED].filter((v) => PLANTILLAS.includes(v)).sort();
    expect(offered, "a template is what you should write today, not what it used to be called").toEqual([]);
  });

  it("the development template leaves a `.env` that starts with nothing to change", () => {
    // What is not commented out is what ends up in your `.env` when you copy it. It should be
    // little and it should be enough: if something had to be filled in by hand, the "starts
    // with no keys" promise would be a lie.
    const active = readFileSync(ROOT + "/.env.example", "utf8")
      .split("\n")
      .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l));
    expect(active.length, "too many active: this is a template, not a manual").toBeLessThan(25);
    const vacias = active
      .map((l) => l.replace(/\s+#.*$/, "")) // a line may carry a trailing comment
      .filter((l) => l.endsWith("="))
      .map((l) => l.split("=")[0]);
    // Only the ones the file itself explains as optional may come empty.
    expect(vacias.sort()).toEqual(["CORTEX_ADMIN_EMAIL", "CORTEX_AUTH_DOMAIN", "CORTEX_EMAIL_FROM"]);
  });
});
