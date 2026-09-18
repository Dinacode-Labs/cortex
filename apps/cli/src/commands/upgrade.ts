import { spawnSync } from "node:child_process";
import { CLI_VERSION } from "../version.js";

/**
 * `cortex upgrade` -- installs the latest published version.
 *
 * It is a shortcut for `npm i -g @dinacodelabs/cortex@latest`, which is what people never
 * remember to type. Afterwards it reminds you about `cortex setup --all`: a new version may
 * bring new hooks or a new plugin, and the CLI on its own does not reconfigure the agents.
 */
const PACKAGE = process.env.CORTEX_NPM_PACKAGE || "@dinacodelabs/cortex";

export async function run(args: string[] = []): Promise<void> {
  if (CLI_VERSION === "dev") {
    console.error("You are running the CLI from the repository (`tsx`), not an installed copy, so `upgrade` does not apply here.");
    process.exitCode = 1;
    return;
  }
  const tag = args.find((a) => !a.startsWith("--")) ?? "latest";
  console.log(`Installing ${PACKAGE}@${tag} (you have ${CLI_VERSION})…`);
  const res = spawnSync("npm", ["install", "-g", `${PACKAGE}@${tag}`], { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`\n✗ npm failed. If it is a permissions problem: npm config set prefix ~/.npm-global && export PATH="$HOME/.npm-global/bin:$PATH"`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ Updated. If this version changes the agent integration, bring it up to date with:\n  cortex setup --all");
}
