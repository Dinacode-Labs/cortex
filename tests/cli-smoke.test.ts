import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLI_VERSION, isOlderThan } from "../apps/cli/src/version.js";

/**
 * The CLI is published to npm, so two things have to line up before that: every command
 * `--help` announces must really exist (a broken `import()` only shows up when it runs), and
 * the package must declare as dependencies exactly what the bundle does NOT carry inside.
 * Publishing `@cortex/client` as a dependency would make npm try to download it.
 */

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../apps/cli/package.json"), "utf8")) as {
  name: string;
  version: string;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files: string[];
};

describe("paquete @dinacodelabs/cortex", () => {
  it("is published with a single binary and only what is needed", () => {
    expect(pkg.name).toBe("@dinacodelabs/cortex");
    expect(pkg.bin).toEqual({ cortex: "./dist/cortex.js" });
    expect(pkg.files).toContain("dist");
  });

  it("does not declare the monorepo packages as dependencies: they go inside the bundle", () => {
    for (const dep of Object.keys(pkg.dependencies)) {
      expect(dep.startsWith("@cortex/"), `${dep} cannot be downloaded from npm`).toBe(false);
    }
    // And they ARE devDependencies, or the bundler would not find them.
    expect(Object.keys(pkg.devDependencies)).toContain("@cortex/client");
  });

  it("keeps out of the bundle what a flat bundle would break", () => {
    // The MCP SDK does dynamic requires; zod and yaml are public and cost nothing to download.
    for (const dep of ["@modelcontextprotocol/sdk", "zod", "yaml"]) expect(pkg.dependencies).toHaveProperty(dep);
  });
});

describe("comandos anunciados", () => {
  it("everything listed in the help can be loaded and has a `run`", async () => {
    const src = readFileSync(resolve(import.meta.dirname, "../apps/cli/src/index.ts"), "utf8");
    const rutas = [...src.matchAll(/import\("(\.\/commands\/[a-z-]+\.js)"\)/g)].map((m) => m[1]!);
    expect(rutas.length).toBeGreaterThan(8);
    for (const ruta of rutas) {
      const mod = (await import(resolve(import.meta.dirname, "../apps/cli/src", ruta.replace("./", "").replace(/\.js$/, ".ts")))) as {
        run?: unknown;
      };
      expect(typeof mod.run, ruta).toBe("function");
    }
  });
});

describe("the CLI's version", () => {
  it("says `dev` in development, and `dev` is never considered old", () => {
    // Under tsx there is no bundle, so the injected constant does not exist.
    expect(CLI_VERSION).toBe("dev");
    expect(isOlderThan("dev", "9.9.9")).toBe(false);
  });

  it("compara versiones sin sorpresas", () => {
    expect(isOlderThan("0.1.0", "0.2.0")).toBe(true);
    expect(isOlderThan("0.9.0", "0.10.0")).toBe(true); // this is not alphabetical order
    expect(isOlderThan("1.0.0", "0.9.9")).toBe(false);
    expect(isOlderThan("0.1.0", "0.1.0")).toBe(false);
  });
});

/**
 * The published bundle has to behave like the sources. What is checked here is what broke once
 * already: esbuild rewrote `import("node:sqlite")` as `import("sqlite")` when bundling, that
 * module does not exist, the import threw and OpenCode and Hermes capture failed silently. It
 * worked in development and did not work installed from npm, which is the worst way for
 * something to be broken.
 *
 * It only runs when the bundle is built: locally it is not always, and in CI it is (there is a
 * build step before the tests).
 */
describe("bundle publicado", () => {
  const bundlePath = resolve(import.meta.dirname, "../apps/cli/dist/cortex.js");
  const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, "utf8") : null;

  it.skipIf(!bundle)("does not lose the `node:` prefix of the built-in modules", () => {
    expect(bundle).not.toMatch(/import\(\s*["']sqlite["']\s*\)/);
    expect(bundle).toContain("node:sqlite");
  });

  it.skipIf(!bundle)("does not read files through `import.meta.dirname`, which points nowhere after bundling", () => {
    expect(bundle).not.toContain("import.meta.dirname");
  });
});
