import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Several Cortex instances at once (ADR-0033). All of this exists to prevent ONE specific
 * failure: one client's knowledge ending up on another's server. It is the worst failure this
 * product can have, because nobody finds out until much later, so the wiring is tested piece by
 * piece rather than trusted to work out.
 */

let home: string;
let repo: string;

async function client() {
  vi.resetModules();
  return import("../packages/client/src/index.js");
}

function writeLink(dir: string, link: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".cortex.json"), JSON.stringify(link));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-mb-home-"));
  repo = mkdtempSync(join(tmpdir(), "cortex-mb-repo-"));
  process.env.CORTEX_HOME = home;
  delete process.env.CORTEX_SERVER_URL;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CORTEX_HOME;
  vi.unstubAllGlobals();
});

describe("credentials per server", () => {
  it("reads the old single-session format without forcing a fresh sign-in", async () => {
    // Anyone upgrading the CLI has a file in the old shape. Were it ignored, they would be
    // locked out with no explanation.
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(
      join(home, ".cortex/credentials"),
      JSON.stringify({ server: "https://viejo.example.com", token: "t-viejo", email: "yo@example.com" }),
    );
    const { readCredentials, listCredentials } = await client();
    expect(readCredentials()?.token).toBe("t-viejo");
    expect(listCredentials()).toHaveLength(1);
  });

  it("stores several sessions and returns the one for the server asked for", async () => {
    const { writeCredentials, readCredentials } = await client();
    writeCredentials({ server: "https://a.example.com", token: "t-a", email: "yo@a.com" });
    writeCredentials({ server: "https://b.example.com", token: "t-b", email: "yo@b.com" });

    expect(readCredentials("https://a.example.com")?.token).toBe("t-a");
    expect(readCredentials("https://b.example.com")?.token).toBe("t-b");
    // With no server asked for, the first one wins: it is the default.
    expect(readCredentials()?.token).toBe("t-a");
  });

  it("a server you have not signed into returns null, not somebody else's session", async () => {
    const { writeCredentials, readCredentials } = await client();
    writeCredentials({ server: "https://a.example.com", token: "t-a", email: "yo@a.com" });
    expect(readCredentials("https://other.example.com")).toBeNull();
  });

  it("a trailing slash does not create a duplicate session", async () => {
    const { writeCredentials, listCredentials, readCredentials } = await client();
    writeCredentials({ server: "https://a.example.com/api", token: "t1", email: "yo@a.com" });
    writeCredentials({ server: "https://a.example.com/api/", token: "t2", email: "yo@a.com" });
    expect(listCredentials()).toHaveLength(1);
    expect(readCredentials("https://a.example.com/api")?.token).toBe("t2");
  });

  it("signing out of one does not sign you out of the rest, and the default is reassigned", async () => {
    const { writeCredentials, clearCredentials, listCredentials, defaultServer } = await client();
    writeCredentials({ server: "https://a.example.com", token: "t-a", email: "yo@a.com" });
    writeCredentials({ server: "https://b.example.com", token: "t-b", email: "yo@b.com" });
    expect(defaultServer()).toBe("https://a.example.com");

    clearCredentials("https://a.example.com");
    expect(listCredentials()).toHaveLength(1);
    // Leaving the default pointing at nothing would fail every call without explaining why.
    expect(defaultServer()).toBe("https://b.example.com");
  });

  it("the file is written with 600 permissions: it holds tokens", async () => {
    const { writeCredentials, credentialsPath } = await client();
    writeCredentials({ server: "https://a.example.com", token: "t", email: "yo@a.com" });
    const { statSync } = await import("node:fs");
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  });
});

describe("the repo decides the server", () => {
  it("a .cortex.json with a server points there, not at the default", async () => {
    const { writeCredentials, useProjectServer, apiBase } = await client();
    writeCredentials({ server: "https://defecto.example.com", token: "t-d", email: "yo@d.com" });
    writeCredentials({ server: "https://client.example.com", token: "t-c", email: "yo@c.com" });

    writeLink(repo, { slug: "client-project", server: "https://client.example.com" });
    useProjectServer(repo);
    expect(apiBase()).toBe("https://client.example.com");
  });

  it("a repo with no server falls back to the default, even after another was in play", async () => {
    const { writeCredentials, useProjectServer, apiBase } = await client();
    writeCredentials({ server: "https://defecto.example.com", token: "t-d", email: "yo@d.com" });

    writeLink(repo, { slug: "otro", server: "https://client.example.com" });
    useProjectServer(repo);
    const sinServer = mkdtempSync(join(tmpdir(), "cortex-mb-repo2-"));
    writeLink(sinServer, { slug: "normal" });
    useProjectServer(sinServer);
    expect(apiBase()).toBe("https://defecto.example.com");
    rmSync(sinServer, { recursive: true, force: true });
  });

  it("the link, and its server, is inherited from a subfolder", async () => {
    const { writeCredentials, useProjectServer, apiBase } = await client();
    writeCredentials({ server: "https://defecto.example.com", token: "t-d", email: "yo@d.com" });
    writeLink(repo, { slug: "raiz", server: "https://client.example.com" });
    const hondo = join(repo, "paquetes", "uno", "src");
    mkdirSync(hondo, { recursive: true });
    useProjectServer(hondo);
    expect(apiBase()).toBe("https://client.example.com");
  });
});

describe("the token sent belongs to the server being called", () => {
  it("another server's token is never sent", async () => {
    // This is the guarantee everything else rests on. With the wrong token it is, at best, a
    // baffling 401 and, at worst, a request to the wrong party.
    const { writeCredentials, useProjectServer, apiRequest } = await client();
    writeCredentials({ server: "https://a.example.com", token: "TOKEN-A", email: "yo@a.com" });
    writeCredentials({ server: "https://b.example.com", token: "TOKEN-B", email: "yo@b.com" });

    const llamadas: { url: string; auth: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        llamadas.push({ url: String(url), auth: String((init.headers as Record<string, string>).authorization ?? "") });
        return new Response("{}", { status: 200 });
      }),
    );

    writeLink(repo, { slug: "p", server: "https://b.example.com" });
    useProjectServer(repo);
    await apiRequest("GET", "/projects");

    expect(llamadas[0]!.url).toBe("https://b.example.com/projects");
    expect(llamadas[0]!.auth).toBe("Bearer TOKEN-B");
  });

  it("with no session for that server nothing is called and it says which one is missing", async () => {
    const { writeCredentials, useProjectServer, apiRequest } = await client();
    writeCredentials({ server: "https://a.example.com", token: "TOKEN-A", email: "yo@a.com" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    writeLink(repo, { slug: "p", server: "https://no-session.example.com" });
    useProjectServer(repo);
    const res = await apiRequest("GET", "/projects");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.data)).toContain("no-session.example.com");
  });
});

describe("the MCP connects to the repo's Cortex", () => {
  it("resolves the server from the cwd, not from the default", async () => {
    // The agent launches `cortex mcp` from the folder being worked in. If the proxy always
    // went to the default, the tools would be querying another client's memory.
    vi.resetModules();
    const { writeCredentials } = await import("../packages/client/src/index.js");
    writeCredentials({ server: "https://defecto.example.com", token: "T-DEF", email: "yo@d.com" });
    writeCredentials({ server: "https://client.example.com", token: "T-CLI", email: "yo@c.com" });
    writeLink(repo, { slug: "p", server: "https://client.example.com" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).startsWith("https://client.example.com")
          ? new Response(JSON.stringify({ mcpUrl: "https://client.example.com/mcp" }), { status: 200 })
          : new Response("{}", { status: 404 }),
      ),
    );

    const { resolveUpstream } = await import("../apps/cli/src/mcp/upstream.js");
    const target = await resolveUpstream(repo);
    expect(target?.url).toBe("https://client.example.com/mcp");
    expect(target?.token).toBe("T-CLI");
  });
});
