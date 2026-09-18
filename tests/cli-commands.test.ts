import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * `commands/` holds commands, and every command is reachable.
 *
 * Both halves break in silence. A helper module parked in there is invisible: it looks like a
 * subcommand in the listing, exports no `run`, and nobody finds it when looking for the library
 * code it actually is. A command file that never makes it into the dispatcher is worse, because
 * it exists, it typechecks, it is imported by nothing, and the only way to notice is somebody
 * asking why `cortex-admin <name>` says the command is unknown.
 */
const ROOT = resolve(import.meta.dirname, "..");

const CLIS = [
  { name: "cortex-admin", dir: "apps/admin/src" },
  { name: "cortex", dir: "apps/cli/src" },
];

const commandFiles = (cli: (typeof CLIS)[number]): string[] =>
  readdirSync(join(ROOT, cli.dir, "commands")).filter((f) => f.endsWith(".ts")).sort();

describe("the CLI command folders", () => {
  it("every file in commands/ is a command: it exports run(args)", () => {
    const strays: string[] = [];
    for (const cli of CLIS) {
      for (const f of commandFiles(cli)) {
        const source = readFileSync(join(ROOT, cli.dir, "commands", f), "utf8");
        if (!/export (async function|function|const) run\b/.test(source)) strays.push(`${cli.dir}/commands/${f}`);
      }
    }
    expect(strays, "library code belongs next to commands/, not inside it").toEqual([]);
  });

  it("every command in commands/ is registered in its dispatcher", () => {
    const unreachable: string[] = [];
    for (const cli of CLIS) {
      const dispatcher = readFileSync(join(ROOT, cli.dir, "index.ts"), "utf8");
      for (const f of commandFiles(cli)) {
        // The literal path is what keeps loading lazy: `cortex --help` must not pay for any of it.
        if (!dispatcher.includes(`./commands/${f.replace(/\.ts$/, ".js")}`)) unreachable.push(`${cli.name}: ${f}`);
      }
    }
    expect(unreachable).toEqual([]);
  });
});
