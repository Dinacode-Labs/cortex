import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse as yamlParse } from "yaml";

/**
 * The deployment cannot be stood up in CI, so what is checked here are the things that, when
 * they break, get discovered in production: that the database is not exposed, that the scripts
 * are valid POSIX, that the image does not run as root and that the compose does not lose a
 * healthcheck. All of this was also verified by hand by standing up the whole stack.
 */
const root = resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

interface Compose {
  services: Record<string, { ports?: string[]; healthcheck?: unknown; command?: string; networks?: string[]; image?: string }>;
  volumes: Record<string, unknown>;
}
const compose = yamlParse(read("deploy/docker-compose.yml")) as Compose;
const local = yamlParse(read("deploy/local.yml")) as Compose;

describe("docker-compose de despliegue", () => {
  it("only Caddy publishes ports: nothing else faces the internet", () => {
    const conPuertos = Object.entries(compose.services)
      .filter(([, s]) => (s.ports?.length ?? 0) > 0)
      .map(([name]) => name);
    expect(conPuertos).toEqual(["caddy"]);
  });

  it("Postgres publishes no ports and does not lose its volume", () => {
    expect(compose.services.postgres!.ports).toBeUndefined();
    expect(Object.keys(compose.volumes)).toContain("cortex-pgdata");
    expect(Object.keys(compose.volumes)).toContain("cortex-backups");
  });

  it("every application service has its healthcheck", () => {
    // server, web and mcp inherit it from the image's HEALTHCHECK through HEALTH_PORT; the
    // worker, which listens on no port, needs its own through a heartbeat file.
    expect(compose.services.worker!.healthcheck).toBeDefined();
    expect(compose.services.postgres!.healthcheck).toBeDefined();
    for (const s of ["server", "web", "mcp"]) {
      expect(JSON.stringify(compose.services[s]), s).toContain("HEALTH_PORT");
    }
  });

  it("migrate runs and exits, it does not restart in a loop", () => {
    const migrate = compose.services.migrate as { restart?: string; command?: string };
    expect(migrate.restart).toBe("no");
    expect(migrate.command).toContain("migrate-cli.js");
  });

  it("the services run dist, never the sources through tsx", () => {
    for (const [name, s] of Object.entries(compose.services)) {
      if (!s.command) continue;
      expect(s.command, name).not.toContain("tsx");
      expect(s.command, name).toMatch(/dist\//);
    }
  });
});

describe("Caddyfile", () => {
  const caddy = read("deploy/Caddyfile");

  it("strips the /api prefix: the server does not know it lives under it", () => {
    expect(caddy).toContain("handle_path /api/*");
  });

  it("no web route hangs off /api: that prefix belongs to the server", () => {
    // `handle_path /api/*` takes those URLs to the API, so a web route under that prefix
    // answers 404 in the deployment even though it works with `apps/web` run on its own. It
    // happened with `/api/graph`, which left the map black without a single error on the page.
    const dir = "apps/web/src/routes";
    const offenders = readdirSync(resolve(root, dir)).filter((f) =>
      /\.(get|post|put|patch|delete|all)\(\s*"\/api/.test(read(`${dir}/${f}`)),
    );
    expect(offenders).toEqual([]);
  });

  it("the MCP goes unbuffered, because it speaks by streaming", () => {
    expect(caddy).toMatch(/handle \/mcp\*[\s\S]*flush_interval -1/);
  });

  it("sets HSTS and removes the Server header", () => {
    expect(caddy).toContain("Strict-Transport-Security");
    expect(caddy).toContain("-Server");
  });
});

describe("Dockerfile", () => {
  const df = read("Dockerfile");

  it("is multi-stage and the final stage does not run as root", () => {
    expect(df).toContain("AS deps");
    expect(df).toContain("AS build");
    expect(df).toContain("AS runtime");
    expect(df).toContain("USER node");
  });

  it("does not use `pnpm prune --prod`, which breaks the workspace links", () => {
    // It took @cortex/shared down with it and the image would not start. It may appear in a
    // comment explaining that; what it may not do is run.
    const ejecuta = df.split("\n").filter((l) => !l.trimStart().startsWith("#") && l.includes("pnpm prune"));
    expect(ejecuta).toEqual([]);
    expect(df).toContain("pnpm install --prod");
  });

  it("copies the data files the apps resolve at runtime", () => {
    expect(df).toContain("scripts/install.sh");
    expect(df).toContain("config/toolbelt.json");
  });

  it("has a HEALTHCHECK with a configurable port (the image serves three services)", () => {
    expect(df).toContain("HEALTHCHECK");
    expect(df).toContain("HEALTH_PORT");
  });
});

describe("operation scripts", () => {
  for (const s of ["deploy/restore.sh", "deploy/backup-now.sh", "deploy/update.sh"]) {
    it(`${s} is valid POSIX and executable`, () => {
      execFileSync("sh", ["-n", resolve(root, s)]);
      expect(statSync(resolve(root, s)).mode & 0o111).toBeGreaterThan(0);
    });
  }

  it("restore.sh asks for a literal confirmation before destroying the real database", () => {
    const sh = read("deploy/restore.sh");
    expect(sh).toContain('"$ANSWER" = "restore"');
    // And it creates the extension before loading: without it, the vector columns fail.
    expect(sh).toMatch(/CREATE EXTENSION IF NOT EXISTS vector[\s\S]*Loading the dump/);
  });

  it("restore.sh does not `source` the .env: there are unquoted values with spaces", () => {
    // The worker's cron expression blew up the whole script under `set -e`.
    expect(read("deploy/restore.sh")).not.toMatch(/^\s*\.\s+\.\/\.env/m);
  });
});

/**
 * Updating a host used to be four commands typed by hand, with the "did it go well?" checklist
 * living in the head of whoever was deploying. What is checked here is what hurts when the
 * script silently loses it: an update that runs before its backup, a host left on a floating
 * tag, and a failure the operator cannot tell apart from a success.
 */
describe("update.sh (updating a host)", () => {
  const sh = read("deploy/update.sh");

  const run = (...args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync("sh", [resolve(root, "deploy/update.sh"), ...args], {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 10_000,
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: `${err.stdout}${err.stderr}` };
    }
  };

  // Where each step is CALLED: comments and the function declarations at the top of the script
  // are left out, or the order asserted below would be the order things are written in.
  const step = (needle: string): number => {
    const i = sh
      .split("\n")
      .findIndex((l) => !l.trimStart().startsWith("#") && !/^\w+\(\)/.test(l) && l.includes(needle));
    expect(i, `the script no longer does: ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it("backs up before pulling and before touching the .env", () => {
    // Going back is not symmetric: migrations only move forward, so a backup taken after the
    // new version has already migrated the schema is a backup of the problem.
    expect(step("./backup-now.sh")).toBeLessThan(step("$COMPOSE pull"));
    expect(step("./backup-now.sh")).toBeLessThan(step('pin_version "$VERSION"'));
  });

  it("refuses to deploy `latest`, and refuses it before doing anything", () => {
    // With `latest` a restart changes version without anybody having decided to. The refusal
    // arrives with no .env and no Docker in sight, which is why this can be run here at all.
    const r = run("latest");
    expect(r.code).toBe(1);
    expect(r.out).toContain("latest");
    expect(r.out).not.toContain("Backing up");
  });

  it("with no version it says how it is used instead of guessing one", () => {
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("Usage:");
  });

  it("does not `source` the .env: there are unquoted values with spaces", () => {
    // The same cron expression that blew up restore.sh under `set -e`.
    expect(sh).not.toMatch(/^\s*\.\s+\.\/\.env/m);
  });

  it("waits for the services to be healthy rather than starting them blind", () => {
    expect(step("$COMPOSE up -d")).toBeLessThan(step("wait_healthy"));
    // migrate runs once and exits: waiting for it to be healthy would never end.
    expect(sh).toMatch(/config --services.*grep -v .\^migrate/);
  });

  it("checks the three URLs the README documents, the MCP by its 401", () => {
    // A 200 on its own does not say Caddy is still routing each path to the service it
    // belongs to, so the answer's own name is what gets checked.
    expect(sh).toContain('"service":"cortex-server"');
    expect(sh).toContain('"service":"cortex-web"');
    expect(sh).toMatch(/MCP_CODE" = "401"/);
  });

  it("on failure it says the host may be halfway and that going back is not symmetric", () => {
    // An operator who cannot tell an updated host from a half-updated one will do nothing,
    // which is the worst of the three outcomes.
    expect(sh).toMatch(/somewhere between/);
    expect(sh).toMatch(/not symmetric/);
    expect(sh).toContain("restore.sh");
  });

  it("the README tells the operator the script exists", () => {
    // A script nobody knows about is four commands typed by hand for ever.
    expect(read("deploy/README.md")).toContain("./deploy/update.sh");
  });
});

describe("deploy/.env.example", () => {
  const env = read("deploy/.env.example");

  it("carries no values from any one company", () => {
    expect(env.toLowerCase()).not.toContain("dinacode.com");
    expect(env).toContain("example.com");
  });

  it("documents what absolutely must be set", () => {
    for (const k of ["CORTEX_DOMAIN", "CORTEX_ACME_EMAIL", "POSTGRES_PASSWORD", "CORTEX_AUTH_DOMAIN", "EMBEDDINGS_DIM"]) {
      expect(env, k).toContain(k);
    }
  });
});

/**
 * The local compose is the first thing somebody approaching Cortex runs, and it runs on that
 * person's machine. What has to be guaranteed is that it opens nothing to the network and asks
 * for no credentials to get started: if the first command is missing a variable, they leave.
 */
describe("local compose (trying it on your machine)", () => {
  it("publishes nothing outside 127.0.0.1", () => {
    const publicados = Object.values(local.services).flatMap((s) => s.ports ?? []);
    expect(publicados.length).toBeGreaterThan(0);
    for (const p of publicados) expect(p).toMatch(/^127\.0\.0\.1:/);
  });

  it("Postgres is not published, not even locally", () => {
    // The host's 5432 is usually taken by something else, and it is not needed at all.
    expect(local.services.postgres!.ports).toBeUndefined();
  });

  it("starts without asking for a single environment variable", () => {
    // `${VAR:?message}` aborts the compose when it is missing. There can be none here.
    expect(read("deploy/local.yml")).not.toMatch(/\$\{[A-Z_]+:\?/);
  });

  it("brings neither TLS nor backups: that is the production compose", () => {
    expect(Object.keys(local.services).sort()).toEqual(["mcp", "migrate", "postgres", "server", "web"]);
  });

  it("the data survives a restart, which is rather the point of a memory", () => {
    expect(Object.keys(local.volumes)).toContain("cortex-local-pgdata");
  });

  it("shares neither volume nor project with the production deployment", () => {
    // A `down -v` in the local trial must not take anybody's data with it.
    expect(read("deploy/local.yml")).toContain("name: cortex-local");
    expect(Object.keys(local.volumes)).not.toContain("cortex-pgdata");
  });
});
