import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * `@cortex/client` exists so the CLI can be bundled and shipped with `npm i -g` (ADR-0025).
 * That only holds if the package does NOT drag in Postgres, Mastra or the embeddings layer:
 * that is ~95 MB with no business being on a dev's laptop.
 *
 * It is an easy rule to break without noticing (an import "that is already there"), so it is
 * checked in a test rather than trusted to review.
 */
const FORBIDDEN = ["@cortex/database", "@cortex/core", "@cortex/agents", "@cortex/embeddings"];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

describe("@cortex/client stays lightweight", () => {
  it("declares @cortex/shared as its only internal dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "packages/client/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const internal = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@cortex/"));
    expect(internal).toEqual(["@cortex/shared"]);
  });

  it("no file imports the heavy packages", () => {
    const offenders: string[] = [];
    for (const f of tsFiles(join(ROOT, "packages/client/src"))) {
      const src = readFileSync(f, "utf8");
      for (const dep of FORBIDDEN) {
        if (src.includes(`from "${dep}"`)) offenders.push(`${f.replace(ROOT, "")} → ${dep}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the `cortex` CLI stays installable", () => {
  it("does not depend on the heavy packages: those live in cortex-admin", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // The two internal packages are bundled, so they are declared as devDependencies: were
    // they in `dependencies`, npm would try to download them when installing the CLI.
    const todas = { ...pkg.dependencies, ...pkg.devDependencies };
    const internal = Object.keys(todas).filter((d) => d.startsWith("@cortex/"));
    expect(internal.sort()).toEqual(["@cortex/client", "@cortex/shared"]);
    expect(Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@cortex/"))).toEqual([]);
  });

  it("no CLI command imports Postgres, core, agents or embeddings", () => {
    const offenders: string[] = [];
    for (const f of tsFiles(join(ROOT, "apps/cli/src"))) {
      const src = readFileSync(f, "utf8");
      for (const dep of FORBIDDEN) {
        if (src.includes(`from "${dep}"`)) offenders.push(`${f.replace(ROOT, "")} → ${dep}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the API's typed client", () => {
  beforeEach(() => {
    vi.stubEnv("CORTEX_SERVER_URL", "https://cortex.example.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("getClientConfig does not throw when the server does not answer: it returns null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { getClientConfig } = await import("@cortex/client");
    await expect(getClientConfig()).resolves.toBeNull();
  });

  it("getClientConfig returns null on an old server (404), without breaking", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    const { getClientConfig } = await import("@cortex/client");
    await expect(getClientConfig()).resolves.toBeNull();
  });

  it("an authenticated endpoint with no credentials returns 401 instead of throwing", async () => {
    // With no `~/.cortex/credentials` (HOME pointing somewhere empty) there is no token.
    vi.stubEnv("HOME", "/tmp/cortex-sin-credenciales-" + Date.now());
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { listProjects } = await import("@cortex/client");
    const res = await listProjects();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
