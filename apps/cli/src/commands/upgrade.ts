import { spawnSync } from "node:child_process";
import { CLI_VERSION } from "../version.js";

/**
 * `cortex upgrade` — instala la última versión publicada.
 *
 * Es un atajo a `npm i -g @dinacode/cortex@latest`, que es lo que la gente no se acuerda de
 * escribir. Después recuerda `cortex setup --all`: una versión nueva puede traer hooks o
 * plugin nuevos, y el CLI por sí solo no reconfigura los agentes.
 */
const PACKAGE = process.env.CORTEX_NPM_PACKAGE || "@dinacode/cortex";

export async function run(args: string[] = []): Promise<void> {
  if (CLI_VERSION === "dev") {
    console.error("Estás ejecutando el CLI desde el repo (`tsx`), no la versión instalada: aquí `upgrade` no aplica.");
    process.exitCode = 1;
    return;
  }
  const tag = args.find((a) => !a.startsWith("--")) ?? "latest";
  console.log(`Instalando ${PACKAGE}@${tag} (tienes ${CLI_VERSION})…`);
  const res = spawnSync("npm", ["install", "-g", `${PACKAGE}@${tag}`], { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`\n✗ npm ha fallado. Si es por permisos: npm config set prefix ~/.npm-global && export PATH="$HOME/.npm-global/bin:$PATH"`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ Actualizado. Si la versión trae cambios en la integración, ponla al día con:\n  cortex setup --all");
}
