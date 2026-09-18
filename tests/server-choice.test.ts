import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Which Cortex a command that does NOT work inside a repository uses.
 *
 * The ones that do -- hooks, `mem`, the MCP proxy, the connectors -- take it from the
 * `.cortex.json` and never ask (ADR-0033): the folder always knows, and the person may not
 * remember.
 *
 * `auth login` used to guess, and guess wrong: it went to the development server by default,
 * ignoring the one already configured, so with two sessions you ended up authenticating
 * against the wrong one without noticing.
 */
let home: string;

function withSessions(...servers_: string[]): void {
  mkdirSync(join(home, ".cortex"), { recursive: true });
  const servers = Object.fromEntries(servers_.map((s) => [s, { token: "t", email: "dev@example.com" }]));
  writeFileSync(join(home, ".cortex/credentials"), JSON.stringify({ version: 2, servers, default: servers_[0] }));
}

async function resolve_(args: string[] = []): Promise<string | null> {
  const { resolveServer } = await import("../apps/cli/src/server.js");
  return resolveServer(args, { verb: "sign in to", allowUnknown: true });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-server-"));
  process.env.CORTEX_HOME = home;
  delete process.env.CORTEX_SERVER_URL;
  vi.resetModules();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.CORTEX_HOME;
  vi.unstubAllEnvs();
});

describe("choosing a server when the folder does not decide", () => {
  it("what is asked for by hand beats everything", async () => {
    withSessions("https://uno.test", "https://dos.test");
    expect(await resolve_(["--server", "https://tres.test"])).toBe("https://tres.test");
  });

  it("the environment beats what is stored: it is how a script says which", async () => {
    withSessions("https://uno.test", "https://dos.test");
    vi.stubEnv("CORTEX_SERVER_URL", "https://del-entorno.test");
    expect(await resolve_()).toBe("https://del-entorno.test");
  });

  it("with a single session, that one; NOT the development default", async () => {
    withSessions("https://el-unico.test");
    expect(await resolve_()).toBe("https://el-unico.test");
  });

  it("with several and nobody in front, it does not guess", async () => {
    withSessions("https://uno.test", "https://dos.test");
    const errors: string[] = [];
    const orig = console.error;
    console.error = ((...a: unknown[]) => errors.push(a.join(" "))) as typeof console.error;
    try {
      expect(await resolve_()).toBeNull();
    } finally {
      console.error = orig;
    }
    // And it says how to get unstuck, listing both options.
    expect(errors.join("\n")).toContain("--server https://uno.test");
    expect(errors.join("\n")).toContain("--server https://dos.test");
  });

  it("with no session at all, the default one (it is somebody's first login)", async () => {
    expect(await resolve_()).toBe("http://localhost:8787");
  });
});
