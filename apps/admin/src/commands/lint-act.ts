import { planLintActions } from "@cortex/core";

/** An action plan (dry run) derived from the lint: open tasks, consolidate duplicates. */
export async function run(args: string[]): Promise<void> {
  const project = args[0];
  if (!project) {
    console.error('Usage: cortex-admin lint-act "<Project>"');
    process.exitCode = 1;
    return;
  }
  const actions = await planLintActions(project);
  console.log(`# Lint action plan — ${project} (dry run)\n`);
  const tasks = actions.filter((a) => a.kind === "open_task");
  const cons = actions.filter((a) => a.kind === "consolidate");
  console.log(`## Open a task in the tracker (${tasks.length})`);
  for (const a of tasks) console.log(`- [ ] ${a.title}\n      ${a.detail}`);
  console.log(`\n## Consolidate duplicates (${cons.length})`);
  for (const a of cons) console.log(`- [ ] ${a.title}\n      ${a.detail}`);
  console.log(
    `\n(${actions.length} actions proposed. Dry run: nothing was written. ` +
      `To create the tasks in Plane, run it supervised with the plane-api skill.)`,
  );
}
