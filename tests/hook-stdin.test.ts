import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A regression from the Pi integration: the hooks hung.
 *
 * Claude Code writes the JSON to stdin and **closes** the pipe. Pi calls the CLI with
 * `execFile`, which leaves stdin open and silent: the `for await` over `process.stdin` never
 * ended, the hook died on the caller's timeout and the agent started with no context without
 * anybody noticing. Here the real CLI is started with stdin open and checked to terminate.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CLI = join(ROOT, "apps/cli/src/index.ts");
let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cortex-hook-stdin-"));
});
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

/**
 * Starts the hook with stdin open and NEVER writing anything. The cwd is the repo root
 * (`--import tsx` resolves from there); the "project" directory goes through `--cwd`.
 * It returns the exit code: when it is not 0 the child died of something else and the test
 * would not be proving anything.
 */
function run(args: string[], limitMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    // `--conditions=development` like the repo's scripts: without it, `@cortex/*` resolves to
    // `dist/`, which in a freshly made clone (CI) does not exist.
    const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx", CLI, ...args], {
      cwd: ROOT,
      stdio: ["pipe", "ignore", "pipe"],
      env: { ...process.env, CORTEX_SERVER_URL: "http://127.0.0.1:9" }, // nobody listens: it does not matter, there is no project
    });
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    const cutoff = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`the hook is still alive after ${limitMs} ms: it hung reading stdin`));
    }, limitMs);
    child.on("exit", (code) => {
      clearTimeout(cutoff);
      // stderr goes into the failure: when the child dies of something else, let it show.
      resolve(code === 0 || !err ? code : (reject(new Error(`exited with ${code}: ${err.slice(0, 600)}`)) as never));
    });
    child.on("error", reject);
  });
}

describe("hooks with stdin open and silent (the way Pi calls them)", () => {
  it("hook-context with --cwd does not wait for stdin", async () => {
    expect(await run(["hook-context", "--format", "text", "--cwd", repo], 20_000)).toBe(0);
  }, 30_000);

  it("hook-context without --cwd exits anyway (the read cap)", async () => {
    expect(await run(["hook-context", "--format", "text"], 20_000)).toBe(0);
  }, 30_000);

  it("hook-capture with --session does not wait for stdin", async () => {
    expect(await run(["hook-capture", "--platform", "pi", "--session", join(repo, "does-not-exist.jsonl"), "--cwd", repo], 20_000)).toBe(0);
  }, 30_000);
});
