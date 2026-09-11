import { spawnSync } from "node:child_process";
import { CLI_VERSION } from "../version.js";

/**
 * `cortex upgrade` — instala la última versión publicada.
 *
 * Es un atajo a `npm i -g @dinacodelabs/cortex@latest`, que es lo que la gente no se acuerda de
 * escribir. Después recuerda `cortex setup --all`: una versión nueva puede traer hooks o
 * plugin nuevos, y el CLI por sí solo no reconfigura los agentes.
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
