import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "@cortex/shared";
loadEnv();
import { closeSql, getSql } from "@cortex/database";
import { canAccessProject, createProject, findProjectBySlug } from "./projects.js";
import { readCortexLink } from "./project-config.js";
import type { Row } from "./map.js";

/** Email autenticado de la CLI (~/.cortex/credentials), o null. Es el dueño al crear. */
function credsEmail(): string | null {
  const f = join(homedir(), ".cortex", "credentials");
  if (!existsSync(f)) return null;
  try {
    return (JSON.parse(readFileSync(f, "utf8")) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

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
      console.error('Uso: cortex:link --create "<Nombre del proyecto>" [--private]');
      process.exitCode = 1;
      return;
    }
    const owner = credsEmail();
    const visibility = args.includes("--private") ? "private" : "public";
    if (visibility === "private" && !owner) {
      console.error("✗ Para crear un proyecto privado necesitas identidad: ejecuta `cortex auth login` primero.");
      process.exitCode = 1;
      return;
    }
    const pi = args.indexOf("--parent");
    const parentSlug = pi >= 0 ? args[pi + 1] : null;
    try {
      const p = await createProject(name, { visibility, ownerEmail: owner, parentSlug });
      writeLink({ slug: p.slug }, `Proyecto "${p.name}" (${p.visibility}${parentSlug ? `, bajo ${parentSlug}` : ""}${owner ? `, dueño ${owner}` : ""}) creado y vinculado · slug: ${p.slug}.`);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exitCode = 1;
    }
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
    if (!(await canAccessProject(p, credsEmail()))) {
      console.error(`✗ El proyecto "${p.name}" es privado y no tienes acceso. Pide al admin que te añada.`);
      process.exitCode = 1;
      return;
    }
    writeLink({ slug: p.slug }, `Vinculado a "${p.name}" (${p.visibility}) · slug: ${p.slug}.`);
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
