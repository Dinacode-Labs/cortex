import { closeSql } from "@cortex/database";
import { lintProject, renderLintReport } from "./lint.js";

/** CLI: tsx src/lint-run.ts "<Proyecto>" */
async function main(): Promise<void> {
  const project = process.argv[2];
  if (!project) {
    console.error('Uso: tsx src/lint-run.ts "<Proyecto>"');
    process.exitCode = 1;
    return;
  }
  console.log(renderLintReport(await lintProject(project)));
}

main()
  .catch((e) => {
    console.error("Error en lint:", e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
