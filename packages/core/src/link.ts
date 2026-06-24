import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "@cortex/shared";
loadEnv();
import { closeSql, getSql } from "@cortex/database";
import { createProject, findProjectBySlug } from "./projects.js";
import { readCortexLink } from "./project-config.js";
import type { Row } from "./map.js";

/**
 * `cortex link`: vincula la carpeta actual a un proyecto Cortex escribiendo `.cortex.json`.
 * Es el acto DELIBERADO que conecta un repo a Cortex (gate inverso: sin vínculo no fluye
 * nada). Crear ≠ vincular: `--create` crea el proyecto en Cortex y lo vincula.
 *
 *   cortex:link <slug>                 vincular a un proyecto EXISTENTE
 *   cortex:link --create "<Nombre>"    crear el proyecto en Cortex y vincular
 *   cortex:link --ignore               opt-out: este repo NO usa Cortex
 *   cortex:link                        ver vínculo actual + proyectos disponibles
 */
// pnpm --filter cambia el cwd al paquete; INIT_CWD conserva el cwd real del usuario.
const TARGET_CWD = process.env.INIT_CWD || process.cwd();

function writeLink(obj: Record<string, unknown>, msg: string): void {
  const file = join(TARGET_CWD, ".cortex.json");
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  console.log(`✓ ${msg}\n  → ${file}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));

  if (args.includes("--ignore")) {
    writeLink({ ignore: true }, "Cortex desactivado en este repo (opt-out).");
    return;
  }

  if (args.includes("--create")) {
    const name = positional.join(" ").trim();
    if (!name) {
      console.error('Uso: cortex:link --create "<Nombre del proyecto>"');
      process.exitCode = 1;
      return;
    }
    const p = await createProject(name);
    writeLink({ slug: p.slug }, `Proyecto "${p.name}" creado en Cortex (slug: ${p.slug}) y vinculado.`);
    return;
  }

  if (positional[0]) {
    const slug = positional[0];
    const p = await findProjectBySlug(slug);
    if (!p) {
      console.error(`✗ No existe ningún proyecto con slug "${slug}" en Cortex.\n  Créalo con: cortex:link --create "<Nombre>"`);
      process.exitCode = 1;
      return;
    }
    writeLink({ slug: p.slug }, `Vinculado a "${p.name}" (slug: ${p.slug}).`);
    return;
  }

  // Sin argumentos: estado + proyectos disponibles.
  const link = readCortexLink(TARGET_CWD);
  console.log(link ? `Vínculo actual: ${JSON.stringify(link)}` : "Sin vínculo en esta carpeta (no hay .cortex.json).");
  const rows = (await getSql()`SELECT slug, name FROM entities WHERE type = 'project' ORDER BY name`) as unknown as Row[];
  console.log("\nProyectos en Cortex:");
  for (const r of rows) console.log(`  ${(r.slug as string) ?? "(sin slug)"}  —  ${r.name as string}`);
  console.log('\nUso:\n  cortex:link <slug>               vincular a un proyecto existente\n  cortex:link --create "<Nombre>"  crear el proyecto y vincular\n  cortex:link --ignore             opt-out (no usar Cortex aquí)');
}

main()
  .catch((e) => {
    console.error("Error en cortex link:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSql();
    process.exit(process.exitCode ?? 0);
  });
