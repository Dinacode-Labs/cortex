import { lintProject, renderLintReport } from "@cortex/core";

/** Lint del conocimiento de un proyecto (salud de la memoria). */
export async function run(args: string[]): Promise<void> {
  const project = args[0];
  if (!project) {
    console.error('Uso: cortex lint "<Proyecto>"');
    process.exitCode = 1;
    return;
  }
  console.log(renderLintReport(await lintProject(project)));
}
