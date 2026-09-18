import { lintProject, renderLintReport } from "@cortex/core";

/** A project's knowledge lint (the memory's health). */
export async function run(args: string[]): Promise<void> {
  const project = args[0];
  if (!project) {
    console.error('Usage: cortex-admin lint "<Project>"');
    process.exitCode = 1;
    return;
  }
  console.log(renderLintReport(await lintProject(project)));
}
