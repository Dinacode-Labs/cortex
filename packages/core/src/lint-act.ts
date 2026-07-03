import { lintProject } from "./lint.js";

/**
 * "Lint que actúa": a partir del informe de lint, propone ACCIONES concretas para
 * cerrar los hallazgos (abrir tareas en el gestor para huecos y contradicciones,
 * consolidar duplicados). Por defecto es **dry-run**: imprime el plan y NO escribe
 * en sistemas externos. La ejecución real (crear tareas en Plane) es una acción
 * con efectos secundarios sobre datos de producción y debe hacerse de forma
 * explícita y supervisada (ver README / skill plane-api).
 */

export interface LintAction {
  kind: "open_task" | "consolidate";
  title: string;
  detail: string;
}

export async function planLintActions(project: string): Promise<LintAction[]> {
  const r = await lintProject(project);
  const actions: LintAction[] = [];

  for (const g of r.gaps) {
    actions.push({
      kind: "open_task",
      title: `Documentar decisión técnica del área «${g.area}»`,
      detail: `${g.incidents} incidencias registradas y 0 decisiones documentadas (${g.type}). Conviene capturar la decisión/criterio vigente.`,
    });
  }
  for (const c of r.contradictions) {
    actions.push({
      kind: "open_task",
      title: `Resolver contradicción en el contexto`,
      detail: `«${c.a}» ⟷ «${c.b}». Revisar cuál es el criterio vigente y marcar el otro como obsoleto/superseded.`,
    });
  }
  for (const d of r.duplicates.slice(0, 10)) {
    actions.push({
      kind: "consolidate",
      title: `Consolidar posible duplicado (${d.score.toFixed(2)})`,
      detail: `«${d.a}» ≈ «${d.b}». Fusionar en una entrada canónica o validar una y marcar la otra.`,
    });
  }
  return actions;
}
