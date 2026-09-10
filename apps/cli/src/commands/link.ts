import {
  createProject,
  getProject,
  listProjects,
  readCortexLink,
  readCredentials,
  writeCortexLink,
  type CortexLink,
} from "@cortex/client";

/**
 * `cortex link`: vincula la carpeta actual a un proyecto de Cortex escribiendo
 * `.cortex.json`. Es el acto DELIBERADO que conecta un repo (gate inverso: sin vínculo no
 * se inyecta ni se captura nada). Crear ≠ vincular: `--create` crea el proyecto y vincula.
 *
 *   cortex link <slug>                 vincular a un proyecto EXISTENTE
 *   cortex link --create "<Nombre>"    crear el proyecto y vincular
 *   cortex link --ignore               opt-out: este repo NO usa Cortex
 *   cortex link                        ver el vínculo actual y los proyectos disponibles
 *
 * Va por la API y no por la base de datos (ADR-0025): era el último comando del CLI que
 * necesitaba Postgres, y mientras lo necesitara no se podía distribuir un cliente ligero.
 */

// `pnpm --filter` cambia el cwd al paquete; INIT_CWD conserva el del usuario.
const TARGET_CWD = process.env.INIT_CWD || process.cwd();

function write(link: CortexLink, msg: string): void {
  const file = writeCortexLink(TARGET_CWD, link);
  console.log(`✓ ${msg}\n  → ${file}`);
}

function requireSession(): boolean {
  if (readCredentials()) return true;
  console.error("✗ No has iniciado sesión. Ejecuta `cortex auth login` primero.");
  process.exitCode = 1;
  return false;
}

/** Mensaje de "existe pero es privado", con los admins a los que pedir acceso. */
function askAccess(name: string, admins?: string[]): string {
  const quien = admins?.length ? ` (${admins.join(", ")})` : "";
  return `✗ El proyecto "${name}" existe pero es privado y no tienes acceso.\n  Pídele acceso a un administrador${quien} — no se ha creado nada.`;
}

export async function run(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));

  if (args.includes("--ignore")) {
    write({ ignore: true }, "Cortex desactivado en este repo (opt-out).");
    return;
  }

  if (args.includes("--create")) {
    const name = positional.join(" ").trim();
    if (!name) {
      console.error('Uso: cortex link --create "<Nombre del proyecto>" [--private] [--parent <slug>]');
      process.exitCode = 1;
      return;
    }
    if (!requireSession()) return;
    const pi = args.indexOf("--parent");
    const res = await createProject({
      name,
      visibility: args.includes("--private") ? "private" : "public",
      ...(pi >= 0 && args[pi + 1] ? { parentSlug: args[pi + 1]! } : {}),
    });
    if (res.status === 403) {
      console.error(askAccess(name, res.data.admins));
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      console.error(`✗ ${res.data.error ?? `No se pudo crear el proyecto (HTTP ${res.status}).`}`);
      process.exitCode = 1;
      return;
    }
    const { project, created } = res.data;
    write(
      { slug: project.slug },
      created
        ? `Proyecto "${project.name}" (${project.visibility}) creado y vinculado · slug: ${project.slug}.`
        : `Ya existía "${project.name}" (${project.visibility}); vinculado · slug: ${project.slug}.`,
    );
    return;
  }

  if (positional[0]) {
    if (!requireSession()) return;
    const slug = positional[0];
    const res = await getProject(slug);
    if (res.status === 404) {
      console.error(`✗ No existe ningún proyecto con slug "${slug}".\n  Créalo con: cortex link --create "<Nombre>"`);
      process.exitCode = 1;
      return;
    }
    if (res.status === 403) {
      console.error(askAccess(slug, (res.data as { admins?: string[] }).admins));
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      console.error(`✗ No se pudo consultar el proyecto (HTTP ${res.status}).`);
      process.exitCode = 1;
      return;
    }
    write({ slug: res.data.project.slug }, `Vinculado a "${res.data.project.name}" · slug: ${res.data.project.slug}.`);
    return;
  }

  // Sin argumentos: estado actual + qué proyectos hay disponibles.
  const link = readCortexLink(TARGET_CWD);
  if (!link) console.log("Esta carpeta NO está vinculada a ningún proyecto (no hay .cortex.json).");
  else if (link.ignore) console.log("Esta carpeta está marcada como IGNORADA para Cortex.");
  else console.log(`Vinculada a: ${link.slug ?? link.project ?? "(vínculo incompleto)"}`);

  if (!readCredentials()) {
    console.log("\nInicia sesión con `cortex auth login` para ver tus proyectos.");
    return;
  }
  const res = await listProjects();
  if (!res.ok) {
    console.log("\nNo se pudo consultar la lista de proyectos (¿servidor en marcha?).");
    return;
  }
  const projects = res.data.projects;
  if (projects.length === 0) {
    console.log('\nNo tienes proyectos todavía. Crea uno con: cortex link --create "<Nombre>"');
    return;
  }
  console.log("\nProyectos a los que tienes acceso:");
  const w = Math.max(...projects.map((p) => p.slug.length));
  for (const p of projects) console.log(`  ${p.slug.padEnd(w)}  ${p.name}${p.visibility === "private" ? " (privado)" : ""}`);
}
