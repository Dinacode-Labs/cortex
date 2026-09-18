import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoSessionError } from "../apps/cli/src/mcp/upstream.js";

/**
 * "You are not signed in" was a lie most of the time.
 *
 * The real case is different: the folder points -- through its `.cortex.json` or through
 * `CORTEX_SERVER_URL` -- at a server there are no credentials for, while there are credentials
 * for another. The message sent people off to repeat a `cortex auth login` they had already
 * done, and whoever read it went round in circles. An error that misdirects costs more than
 * one that stays quiet, because it looks like it knows.
 */
const homes: string[] = [];

function withSessions(servers: [string, string][]): string {
  const home = mkdtempSync(join(tmpdir(), "cortex-home-"));
  homes.push(home);
  mkdirSync(join(home, ".cortex"));
  writeFileSync(
    join(home, ".cortex", "credentials"),
    JSON.stringify({
      version: 2,
      default: servers[0]?.[0],
      servers: Object.fromEntries(servers.map(([s, email]) => [s, { token: "t", email }])),
    }),
  );
  process.env.CORTEX_HOME = home;
  return home;
}

afterEach(() => {
  delete process.env.CORTEX_HOME;
  for (const c of homes.splice(0)) rmSync(c, { recursive: true, force: true });
});

describe("when the MCP cannot authenticate", () => {
  it("says WHICH server it looked for, not something generic", () => {
    withSessions([["https://cortex.example.com/api", "yo@example.com"]]);
    const e = new NoSessionError("http://localhost:8787", "/repos/my-project");
    expect(e.message).toContain("http://localhost:8787");
    expect(e.message).toContain("/repos/my-project");
  });

  it("and shows the sessions that DO exist, which is what untangles it", () => {
    withSessions([["https://cortex.example.com/api", "yo@example.com"]]);
    const e = new NoSessionError("https://cortex.example.com", "/repos/my-project");
    expect(e.message).toContain("https://cortex.example.com/api");
    expect(e.message).toContain("yo@example.com");
    // With another session available, the first thing it suggests is looking at where the
    // folder points, not repeating the login that was already done.
    expect(e.message).toMatch(/\.cortex\.json|CORTEX_SERVER_URL/);
  });

  it("when there really is no session at all, it says so and sends you to sign in", () => {
    withSessions([]);
    const e = new NoSessionError("https://cortex.example.com/api", "/repos/x");
    expect(e.message).toContain("no sessions on this machine");
    expect(e.message).toContain("cortex auth login --server https://cortex.example.com/api");
  });
});
