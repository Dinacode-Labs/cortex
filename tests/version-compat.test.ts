import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Versioning between CLI and server (ADR-0062). They are two different clocks: each person
 * updates the CLI from npm, and an operator updates the server. They are not tied together; the
 * two numbers the server publishes are compared and three behaviours come out of that:
 *
 *   - a passive notice, ONE line to stderr, only with a terminal in front and at most once a day;
 *   - a block on the commands that write when the CLI is below the minimum;
 *   - and nothing, ever, in the hooks or in `cortex mcp`, where stdout is protocol.
 *
 * The CLI says `dev` in tests, which compares with nothing; here it is made to believe it is
 * 0.1.9.
 */
vi.mock("../apps/cli/src/version.ts", async (orig) => ({ ...(await orig<typeof import("../apps/cli/src/version.js")>()), CLI_VERSION: "0.1.9" }));

const SERVER = "http://cortex.test";
let home: string;

/** A server announcing `version` and `minClientVersion`; `null` = no answer; 404 = a server with no `/client-config`. */
function server(cfg: { version: string; minClientVersion?: string } | null | 404): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (url: string) => {
    if (cfg === null) throw new TypeError("fetch failed");
    if (cfg === 404 || !String(url).endsWith("/client-config")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ apiUrl: SERVER, mcpUrl: `${SERVER}/mcp`, webUrl: SERVER, ...cfg }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function conSesion(): void {
  mkdirSync(join(home, ".cortex"), { recursive: true });
  writeFileSync(join(home, ".cortex/credentials"), JSON.stringify({ server: SERVER, token: "t0ken", email: "dev@example.com" }));
}

async function compat() {
  return import("../apps/cli/src/compat.js");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-compat-"));
  process.env.CORTEX_HOME = home;
  process.env.CORTEX_SERVER_URL = SERVER;
  delete process.env.CI;
  delete process.env.CORTEX_NO_VERSION_CHECK;
  vi.resetModules();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.CORTEX_HOME;
  delete process.env.CORTEX_SERVER_URL;
  vi.unstubAllGlobals();
});

describe("comparar versiones", () => {
  it("orders by number, not by text, and tolerates prefixes and prereleases", async () => {
    const { compareVersions, isOlderThan } = await import("../apps/cli/src/version.js");
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.12", "0.1.12")).toBe(0);
    expect(compareVersions("v0.1.12", "0.1.12-beta.1")).toBe(0);
    expect(compareVersions("0.1.12-rc.1", "0.1.11")).toBeGreaterThan(0);
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    // `dev` is not comparable: it neither blocks nor warns.
    expect(compareVersions("dev", "9.9.9")).toBe(0);
    expect(isOlderThan("0.1.9", "0.1.10")).toBe(true);
    expect(isOlderThan("dev", "9.9.9")).toBe(false);
  });
});

describe("what the relationship between CLI and server is", () => {
  it("one conclusion per case, and what is unknown is \"unknown\", not an error", async () => {
    const { classify } = await compat();
    const k = (cli: string, cfg: Parameters<typeof classify>[2]) => classify(SERVER, cli, cfg).kind;
    expect(k("0.1.9", { version: "0.1.9", minClientVersion: "0.1.0" })).toBe("ok");
    expect(k("0.1.9", { version: "0.1.12", minClientVersion: "0.1.0" })).toBe("cli-behind");
    expect(k("0.1.12", { version: "0.1.9", minClientVersion: "0.1.0" })).toBe("server-behind");
    expect(k("0.1.9", { version: "0.1.12", minClientVersion: "0.1.10" })).toBe("blocked");
    // The minimum wins over everything else: a CLI below it is blocked even when the server is ahead.
    expect(k("0.1.9", { version: "0.1.12", minClientVersion: "0.1.9" })).toBe("cli-behind");
    // A server predating `minClientVersion`, or with no `/client-config`, or in development.
    expect(k("0.1.9", { version: "0.1.12" })).toBe("cli-behind");
    expect(k("0.1.9", null)).toBe("unknown");
    expect(k("0.1.9", { version: "dev" })).toBe("unknown");
    expect(k("dev", { version: "0.1.12", minClientVersion: "0.1.12" })).toBe("unknown");
  });
});

describe("the query is cached", () => {
  it("once every 24 h per server; `fresh` forces it; a failure is retried sooner", async () => {
    const { serverCompat, compatCachePath } = await compat();
    let t = Date.parse("2026-09-16T10:00:00Z");
    const now = () => t;
    const f = server({ version: "0.1.12", minClientVersion: "0.1.0" });

    expect((await serverCompat(SERVER, { now })).fetched).toBe(true);
    expect(existsSync(compatCachePath())).toBe(true);
    expect((await serverCompat(SERVER, { now })).fetched).toBe(false);
    t += 23 * 3600_000;
    expect((await serverCompat(SERVER, { now })).fetched).toBe(false);
    expect((await serverCompat(SERVER, { now, fresh: true })).fetched).toBe(true);
    t += 25 * 3600_000;
    const r = await serverCompat(SERVER, { now });
    expect(r.fetched).toBe(true);
    expect(r.compat.kind).toBe("cli-behind");
    expect(f).toHaveBeenCalledTimes(3);

    // The server is down: unknown, and it is checked again in an hour (not a day).
    server(null);
    t += 25 * 3600_000;
    expect((await serverCompat(SERVER, { now })).compat.kind).toBe("unknown");
    t += 30 * 60_000;
    expect((await serverCompat(SERVER, { now })).fetched).toBe(false);
    t += 31 * 60_000;
    expect((await serverCompat(SERVER, { now })).fetched).toBe(true);
  });

  it("a corrupt cache is ignored rather than breaking the command", async () => {
    const { serverCompat, compatCachePath } = await compat();
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(compatCachePath(), "{ this is not json");
    server({ version: "0.1.9", minClientVersion: "0.1.0" });
    expect((await serverCompat(SERVER)).compat.kind).toBe("ok");
    expect(JSON.parse(readFileSync(compatCachePath(), "utf8")).version).toBe(1);
  });
});

describe("the passive notice", () => {
  it("with no terminal in front it says nothing, even when a new version exists", async () => {
    const { printVersionNotice } = await compat();
    conSesion();
    server({ version: "0.1.12", minClientVersion: "0.1.0" });
    const out: string[] = [];
    await printVersionNotice({ tty: false, write: (l) => out.push(l) });
    expect(out).toEqual([]);
  });

  it("with a terminal: ONE line, and it is not repeated until a day has passed", async () => {
    const { printVersionNotice } = await compat();
    conSesion();
    server({ version: "0.1.12", minClientVersion: "0.1.0" });
    let t = Date.parse("2026-09-16T10:00:00Z");
    const now = () => t;
    const out: string[] = [];
    await printVersionNotice({ tty: true, now, write: (l) => out.push(l) });
    expect(out).toEqual(["Cortex 0.1.9 → 0.1.12 · cortex upgrade"]);
    await printVersionNotice({ tty: true, now, write: (l) => out.push(l) });
    expect(out).toHaveLength(1);
    t += 25 * 3600_000;
    await printVersionNotice({ tty: true, now, write: (l) => out.push(l) });
    expect(out).toHaveLength(2);
  });

  it("when it is the server that is behind, it tells whoever can warn the operator", async () => {
    const { printVersionNotice } = await compat();
    conSesion();
    server({ version: "0.1.7", minClientVersion: "0.1.0" });
    const out: string[] = [];
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("server at http://cortex.test runs 0.1.7");
    expect(out[0]).toContain("whoever operates it");
  });

  it("stays quiet with no session for that server, with CI set, or when switched off by variable", async () => {
    const { printVersionNotice } = await compat();
    const f = server({ version: "0.1.12", minClientVersion: "0.1.0" });
    const out: string[] = [];
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    expect(f).not.toHaveBeenCalled(); // with no credentials it is not even queried

    conSesion();
    process.env.CI = "1";
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    delete process.env.CI;
    process.env.CORTEX_NO_VERSION_CHECK = "1";
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    expect(out).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("it is not shown with an up-to-date CLI, nor when the server does not answer", async () => {
    const { printVersionNotice } = await compat();
    conSesion();
    const out: string[] = [];
    server({ version: "0.1.9", minClientVersion: "0.1.0" });
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    server(null);
    await printVersionNotice({ tty: true, fresh: true, write: (l) => out.push(l) });
    expect(out).toEqual([]);
  });
});

describe("blocking writes below the minimum", () => {
  it("below the minimum, a clear reason pointing at `cortex upgrade`", async () => {
    const { writeBlocker, requireCompatibleServer } = await compat();
    server({ version: "0.1.12", minClientVersion: "0.1.10" });
    const why = await writeBlocker();
    expect(why).toContain("0.1.9");
    expect(why).toContain("0.1.10");
    expect(why).toContain("cortex upgrade");
    await expect(requireCompatibleServer()).rejects.toThrow(/cortex upgrade/);
  });

  it("queries fresh: a freshly raised minimum stops things today, not tomorrow", async () => {
    const { serverCompat, writeBlocker } = await compat();
    server({ version: "0.1.12", minClientVersion: "0.1.0" });
    await serverCompat(SERVER); // a fresh cache saying all is well
    server({ version: "0.1.12", minClientVersion: "0.1.10" });
    expect(await writeBlocker()).not.toBeNull();
  });

  it("does not block what it does not know: a server down, an old server with no `/client-config`, or within the minimum", async () => {
    const { writeBlocker } = await compat();
    server(null);
    expect(await writeBlocker()).toBeNull();
    server(404);
    expect(await writeBlocker()).toBeNull();
    server({ version: "0.1.12", minClientVersion: "0.1.9" });
    expect(await writeBlocker()).toBeNull();
  });

  it("`cortex mem save` refuses with the same message, in --json too", async () => {
    const { run } = await import("../apps/cli/src/commands/mem.js");
    server({ version: "0.1.12", minClientVersion: "0.1.10" });
    conSesion();
    const cwd = mkdtempSync(join(tmpdir(), "cortex-compat-cwd-"));
    writeFileSync(join(cwd, ".cortex.json"), JSON.stringify({ slug: "acme" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await run(["save", "hola", "--cwd", cwd, "--json"]);
      const output = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { error?: string };
      expect(output.error).toContain("cortex upgrade");
      expect(process.exitCode).toBe(1);
      // And it did not even try to store: the only request was the version one.
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.every((c) => String(c[0]).endsWith("/client-config"))).toBe(true);
    } finally {
      log.mockRestore();
      process.exitCode = 0;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/**
 * The critical part. In the hooks and in `cortex mcp`, stdout is the agent's protocol channel:
 * one extra byte breaks the session. It is checked two ways: that those entrypoints do not even
 * know the notice module (and the dispatcher lets them go before reaching it), and by starting
 * the real CLI with a cache saying "there is a new version" to see that nothing comes out of
 * either stream.
 */
describe("the hooks and the MCP say NOTHING", () => {
  const RAIZ = resolve(import.meta.dirname, "..");
  const SRC = join(RAIZ, "apps/cli/src");

  it("they neither import the notice nor have the dispatcher apply it (they are `managed: false`)", () => {
    for (const f of ["commands/hook-context.ts", "commands/hook-capture.ts", "commands/mcp.ts", "mcp/proxy.ts", "mcp/upstream.ts"]) {
      expect(readFileSync(join(SRC, f), "utf8"), f).not.toMatch(/compat\.js/);
    }
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    for (const cmd of ["mcp", "hook-context", "hook-capture"]) {
      expect(index, cmd).toMatch(new RegExp(`"?${cmd}"?: \\{[^}]*managed: false`));
    }
    // The notice comes AFTER the `return` of the `managed: false` ones.
    expect(index.indexOf("cmd.managed === false")).toBeGreaterThan(0);
    expect(index.indexOf("printVersionNotice()")).toBeGreaterThan(index.indexOf("cmd.managed === false"));
  });

  function run(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
    return new Promise((resolve, reject) => {
      const hijo = spawn(process.execPath, ["--conditions=development", "--import", "tsx", join(SRC, "index.ts"), ...args], {
        cwd: RAIZ,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
      let out = "";
      let err = "";
      hijo.stdout.on("data", (d) => (out += String(d)));
      hijo.stderr.on("data", (d) => (err += String(d)));
      const corte = setTimeout(() => {
        hijo.kill("SIGKILL");
        reject(new Error("the hook did not finish"));
      }, 20_000);
      hijo.stdin.end();
      hijo.on("exit", (code) => {
        clearTimeout(corte);
        resolve({ code, out, err });
      });
      hijo.on("error", reject);
    });
  }

  it("hook-context and hook-capture, with a cache saying there is a new version, emit not one byte", async () => {
    conSesion();
    const { compatCachePath } = await compat();
    writeFileSync(compatCachePath(), JSON.stringify({ version: 1, servers: { [SERVER]: { at: new Date().toISOString(), version: "9.9.9", minClientVersion: "9.0.0" } } }));
    const repo = mkdtempSync(join(tmpdir(), "cortex-compat-repo-"));
    try {
      const env = { CORTEX_HOME: home, CORTEX_SERVER_URL: "http://127.0.0.1:9" };
      const ctx = await run(["hook-context", "--format", "text", "--cwd", repo], env);
      expect(ctx).toEqual({ code: 0, out: "", err: "" });
      const cap = await run(["hook-capture", "--platform", "pi", "--session", join(repo, "no.jsonl"), "--cwd", repo], env);
      expect(cap).toEqual({ code: 0, out: "", err: "" });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);
});
