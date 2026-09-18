import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SetupCtx } from "../apps/cli/src/setup/types.js";

/**
 * `cortex doctor` exists for one specific situation: something is wrong and the dev does not
 * know which piece it is. So what has to be checked is that it **names the broken piece and
 * says what to do**, and that it exits with code 1 only when something really stops Cortex
 * working (an unconfigured agent is a warning, not a failure).
 */

let home: string;
let cwd: string;
/**
 * A context with no agents detected: asking each agent for its status means running its binary,
 * and that neither can nor should happen in a test.
 */
const ctxSinAgentes = (): SetupCtx => ({
  home,
  dryRun: true,
  remove: false,
  noPlugin: false,
  log: () => {},
  detect: () => false,
  exec: () => "",
  now: () => new Date("2026-09-10T12:00:00Z"),
});

interface Resultado {
  text: string;
  hasError: boolean;
}

async function runDoctor(): Promise<Resultado> {
  const { collectChecks } = await import("../apps/cli/src/commands/doctor.js");
  const checks = await collectChecks(ctxSinAgentes(), cwd);
  return {
    text: checks.map((c) => `${c.level} ${c.name} ${c.detail}${c.fix ? ` → ${c.fix}` : ""}`).join("\n"),
    hasError: checks.some((c) => c.level === "error"),
  };
}

function conCredenciales(server = "http://cortex.test"): void {
  mkdirSync(join(home, ".cortex"), { recursive: true });
  writeFileSync(join(home, ".cortex/credentials"), JSON.stringify({ server, token: "t0ken", email: "dev@example.com" }));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-doctor-home-"));
  cwd = mkdtempSync(join(tmpdir(), "cortex-doctor-cwd-"));
  process.env.CORTEX_HOME = home;
  process.env.INIT_CWD = cwd;
  vi.resetModules();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  delete process.env.CORTEX_HOME;
  delete process.env.INIT_CWD;
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

describe("cortex doctor", () => {
  it("with no session, it says so and sends you to sign in", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { text, hasError } = await runDoctor();
    expect(text).toContain("not signed in");
    expect(text).toContain("cortex auth login");
    expect(hasError).toBe(true);
  });

  it("when the server does not answer, it points at the server and not at the token", async () => {
    conCredenciales();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
    const { text, hasError } = await runDoctor();
    expect(text).toMatch(/Server not responding/);
    expect(text).not.toContain("Token");
    expect(hasError).toBe(true);
  });

  it("with an expired token, it points at the token", async () => {
    conCredenciales();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/health")) return new Response("{}", { status: 200 });
        return new Response("{}", { status: 401 });
      }),
    );
    const { text, hasError } = await runDoctor();
    expect(text).toMatch(/Token rejected/);
    expect(text).toContain("cortex auth login");
    expect(hasError).toBe(true);
  });

  it("everything running: a 401 from the MCP counts as alive, because it is asking for auth", async () => {
    conCredenciales();
    writeFileSync(join(cwd, ".cortex.json"), JSON.stringify({ slug: "acme-portal" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.endsWith("/health")) return new Response("{}", { status: 200 });
        if (u.includes("/auth/me")) return new Response(JSON.stringify({ user: { email: "dev@example.com" } }), { status: 200 });
        if (u.includes("/client-config"))
          return new Response(JSON.stringify({ apiUrl: "http://cortex.test", mcpUrl: "http://cortex.test/mcp", webUrl: "http://x", version: "0.1.0", minClientVersion: "0.1.0" }), { status: 200 });
        if (u.endsWith("/mcp")) return new Response("Unauthorized", { status: 401 });
        return new Response("{}", { status: 404 });
      }),
    );
    const { text, hasError } = await runDoctor();
    expect(text).toMatch(/ok MCP/);
    expect(text).toContain('linked to "acme-portal"');
    expect(hasError).toBe(false);
  });

  /**
   * With two servers (ADR-0033), one being down does not mean Cortex does not work: it means
   * that one does not. If this folder uses the other, and the other answers, the diagnosis has
   * to say everything essential works. It used to say "1 problem stopping Cortex from working",
   * which is an expensive false alarm: the first time somebody sees it, they stop trusting the
   * whole diagnosis.
   */
  it("a server that is down and this folder does not use is a warning, not a failure", async () => {
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(
      join(home, ".cortex/credentials"),
      JSON.stringify({
        version: 2,
        servers: {
          "http://alive.test": { token: "t1", email: "dev@example.com" },
          "http://dead.test": { token: "t2", email: "dev@example.com" },
        },
        default: "http://alive.test",
      }),
    );
    writeFileSync(join(cwd, ".cortex.json"), JSON.stringify({ slug: "x", server: "http://alive.test" }));
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("dead.test")) throw new Error("fetch failed");
      return new Response(JSON.stringify({ ok: true, mcpUrl: "http://alive.test/mcp" }), { status: 200 });
    });

    const r = await runDoctor();
    expect(r.text).toContain("warn Server · dead.test");
    expect(r.text).toContain("cortex auth logout --server http://dead.test");
    expect(r.hasError, "a server that is not used cannot block").toBe(false);
  });

  /** But the one this folder DOES use blocks when it does not answer: there is no Cortex there. */
  it("when the one that is down is the one this folder uses, then it is a failure", async () => {
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(
      join(home, ".cortex/credentials"),
      JSON.stringify({
        version: 2,
        servers: {
          "http://alive.test": { token: "t1", email: "dev@example.com" },
          "http://dead.test": { token: "t2", email: "dev@example.com" },
        },
        default: "http://alive.test",
      }),
    );
    writeFileSync(join(cwd, ".cortex.json"), JSON.stringify({ slug: "x", server: "http://dead.test" }));
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("dead.test")) throw new Error("fetch failed");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    expect((await runDoctor()).hasError).toBe(true);
  });

  it("an unlinked folder is a warning, with the command to link it", async () => {
    conCredenciales();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { text } = await runDoctor();
    expect(text).toContain("not linked to any project");
    expect(text).toContain("cortex link");
  });
});
