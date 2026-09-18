import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `install.sh` is run by people with `curl ... | sh`, which is the most direct way there is of
 * breaking somebody's machine. There is no way to test the real installation in CI, so what is
 * checked is what can be: that the script is valid for `sh` (not bash), that the server can
 * inject its URL, and that none of the things we removed have come back.
 */
const SCRIPT = resolve(import.meta.dirname, "../scripts/install.sh");
const src = readFileSync(SCRIPT, "utf8");

describe("scripts/install.sh", () => {
  it("is valid POSIX syntax and executable", () => {
    execFileSync("sh", ["-n", SCRIPT]);
    expect(statSync(SCRIPT).mode & 0o111).toBeGreaterThan(0);
  });

  it("carries the slot where the server injects its URL", () => {
    // apps/server/src/routes/install.ts does the replacement when serving it.
    expect(src).toContain("__CORTEX_SERVER_URL__");
    expect(src.split("__CORTEX_SERVER_URL__").length - 1).toBeGreaterThanOrEqual(1);
  });

  it("installs from npm and does not clone the repo", () => {
    expect(src).toContain("npm install -g");
    expect(src).not.toContain("git clone");
    expect(src).not.toContain("pnpm install");
    expect(src).not.toContain(".dinacode-cortex");
  });

  it("requires Node >= 20 but does not install it on its own", () => {
    expect(src).toContain('"$MAJOR" -ge 20');
    // Installing a version of Node behind somebody's back breaks their other projects: those
    // commands may only appear as a printed suggestion, never as a line that runs.
    const runs = src.split("\n").filter((l) => /^\s*(brew|nvm|fnm|corepack)\s/.test(l));
    expect(runs).toEqual([]);
  });

  it("configures the agents with `cortex setup`, not the retired command", () => {
    expect(src).toContain("cortex setup --all");
    expect(src).not.toContain("cortex sync");
  });

  it("reads the code from the terminal, not from stdin (curl | sh has taken it)", () => {
    expect(src).toContain("/dev/tty");
    expect(src).toContain("cortex auth login --server");
  });

  /**
   * The installer used to silence npm's output and always blame permissions. A package that
   * does not exist, a registry outage or a proxy in the way sent people off to reconfigure
   * their npm for nothing, which is the worst possible first impression.
   */
  it("tells apart why npm failed instead of always blaming permissions", () => {
    const sh = src;
    expect(sh).toMatch(/E404|404 Not Found/);
    expect(sh).toMatch(/EACCES|EPERM/);
    expect(sh).toMatch(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/);
    // And when it is none of the three, it shows what npm said rather than inventing a cause.
    expect(sh).toContain("This is what npm said");
    // The output is no longer thrown away: without keeping it there is nothing to look at.
    expect(sh).not.toMatch(/npm install -g "\$PKG" >\/dev\/null/);
  });
});
