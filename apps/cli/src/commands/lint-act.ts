import { planLintActions } from "@cortex/core";

/** Plan de acciones (dry-run) a partir del lint: abrir tareas, consolidar duplicados. */
export async function run(args: string[]): Promise<void> {
  const project = args[0];
  if (!project) {
    console.error('Uso: cortex lint-act "<Proyecto>"');
    process.exitCode = 1;
    return;
  }
  const actions = await planLintActions(project);
  console.log(`# Plan de acciones de Lint — ${project} (dry-run)\n`);
  const tasks = actions.filter((a) => a.kind === "open_task");
  const cons = actions.filter((a) => a.kind === "consolidate");
  console.log(`## Abrir tarea en el gestor (${tasks.length})`);
  for (const a of tasks) console.log(`- [ ] ${a.title}\n      ${a.detail}`);
  console.log(`\n## Consolidar duplicados (${cons.length})`);
  for (const a of cons) console.log(`- [ ] ${a.title}\n      ${a.detail}`);
  console.log(
    `\n(${actions.length} acciones propuestas. Dry-run: no se ha escrito nada. ` +
      `Para crear las tareas en Plane, ejecútalo de forma supervisada con la skill plane-api.)`,
  );
}
