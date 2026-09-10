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
  console.error("✗ Not signed in. Run `cortex auth login` first.");
  process.exitCode = 1;
  return false;
}

/** Mensaje de "existe pero es privado", con los admins a los que pedir acceso. */
function askAccess(name: string, admins?: string[]): string {
  const quien = admins?.length ? ` (${admins.join(", ")})` : "";
  return `✗ The project "${name}" exists but is private and you do not have access.\n  Ask an administrator${quien} for access. Nothing was created.`;
}

export async function run(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));

  if (args.includes("--ignore")) {
    write({ ignore: true }, "Cortex turned off for this repository (opt-out).");
    return;
  }

  if (args.includes("--create")) {
    const name = positional.join(" ").trim();
    if (!name) {
      console.error('Usage: cortex link --create "<Project name>" [--private] [--parent <slug>]');
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
      console.error(`✗ ${res.data.error ?? `Could not create the project (HTTP ${res.status}).`}`);
      process.exitCode = 1;
      return;
    }
    const { project, created } = res.data;
    write(
      { slug: project.slug },
      created
        ? `Project "${project.name}" (${project.visibility}) created and linked · slug: ${project.slug}.`
        : `"${project.name}" (${project.visibility}) already existed; linked · slug: ${project.slug}.`,
    );
    return;
  }

  if (positional[0]) {
    if (!requireSession()) return;
    const slug = positional[0];
    const res = await getProject(slug);
    if (res.status === 404) {
      console.error(`✗ There is no project with slug "${slug}".\n  Create it with: cortex link --create "<Name>"`);
      process.exitCode = 1;
      return;
    }
    if (res.status === 403) {
      console.error(askAccess(slug, (res.data as { admins?: string[] }).admins));
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      console.error(`✗ Could not look up the project (HTTP ${res.status}).`);
      process.exitCode = 1;
      return;
    }
    write({ slug: res.data.project.slug }, `Linked to "${res.data.project.name}" · slug: ${res.data.project.slug}.`);
    return;
  }

  // Sin argumentos: estado actual + qué proyectos hay disponibles.
  const link = readCortexLink(TARGET_CWD);
  if (!link) console.log("This folder is NOT linked to any project (there is no .cortex.json).");
  else if (link.ignore) console.log("This folder is marked as IGNORED for Cortex.");
  else console.log(`Linked to: ${link.slug ?? link.project ?? "(incomplete link)"}`);

  if (!readCredentials()) {
    console.log("\nSign in with `cortex auth login` to see your projects.");
    return;
  }
  const res = await listProjects();
  if (!res.ok) {
    console.log("\nCould not fetch the list of projects. Is the server running?");
    return;
  }
  const projects = res.data.projects;
  if (projects.length === 0) {
    console.log('\nYou have no projects yet. Create one with: cortex link --create "<Name>"');
    return;
  }
  console.log("\nProjects you can access:");
  const w = Math.max(...projects.map((p) => p.slug.length));
  for (const p of projects) console.log(`  ${p.slug.padEnd(w)}  ${p.name}${p.visibility === "private" ? " (private)" : ""}`);
}
