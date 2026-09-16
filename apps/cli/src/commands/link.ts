import {
  apiBase,
  createProject,
  defaultServer,
  getProject,
  listCredentials,
  listProjects,
  readCortexLink,
  readCredentials,
  setActiveServer,
  useProjectServer,
  writeCortexLink,
  type CortexLink,
} from "@cortex/client";
import { requireCompatibleServer } from "../compat.js";

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
 * Con `--server` se vincula a un Cortex que no es el de por defecto, y el `.cortex.json` se
 * lo queda (ADR-0033). Con varios servidores configurados, `--create` EXIGE decir cuál: es
 * el único punto del flujo donde alguien podría crear el proyecto de un cliente en el
 * servidor de otro, y de ahí en adelante ya no habría forma de darse cuenta.
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
  if (readCredentials(apiBase())) return true;
  console.error(`✗ Not signed in to ${apiBase()}. Run: cortex auth login --server ${apiBase()}`);
  process.exitCode = 1;
  return false;
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

/**
 * A qué servidor va esta operación: lo que diga `--server`, si no lo que ya dijera el repo,
 * si no el de por defecto. Devuelve también si fue explícito, que es lo que decide si el
 * `.cortex.json` se guarda el servidor o se queda con el de por defecto.
 */
function resolveServer(args: string[]): { server: string | undefined; explicit: boolean } {
  const explicito = flagValue(args, "server");
  if (explicito) {
    setActiveServer(explicito);
    return { server: explicito, explicit: true };
  }
  const link = readCortexLink(TARGET_CWD);
  setActiveServer(link?.server ?? null);
  return { server: link?.server, explicit: false };
}

/** Con varias sesiones, crear sin decir dónde es el error caro. Se corta antes. */
function requireExplicitServerToCreate(server: string | undefined): boolean {
  const sesiones = listCredentials();
  if (server || sesiones.length <= 1) return true;
  console.error("✗ You are signed in to more than one Cortex. Say which one should hold this project:\n");
  for (const c of sesiones) console.error(`    cortex link --create "<Name>" --server ${c.server}${c.server === defaultServer() ? "   (default)" : ""}`);
  console.error("\n  Nothing was created. Creating it on the wrong server is not something you would notice later.");
  process.exitCode = 1;
  return false;
}

/** Mensaje de "existe pero es privado", con los admins a los que pedir acceso. */
function askAccess(name: string, admins?: string[]): string {
  const quien = admins?.length ? ` (${admins.join(", ")})` : "";
  return `✗ The project "${name}" exists but is private and you do not have access.\n  Ask an administrator${quien} for access. Nothing was created.`;
}

export async function run(args: string[]): Promise<void> {
  // Los valores de --server y --parent no son nombres de proyecto.
  const consumidos = new Set<string>();
  for (const f of ["--server", "--parent"]) {
    const i = args.indexOf(f);
    if (i >= 0 && args[i + 1]) consumidos.add(args[i + 1]!);
  }
  const positional = args.filter((a) => !a.startsWith("--") && !consumidos.has(a));
  const { server, explicit } = resolveServer(args);
  /** El servidor solo se guarda en el .cortex.json si NO es el de por defecto. */
  const serverField = (): { server?: string } => (server && server !== defaultServer() ? { server } : {});

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
    if (!requireExplicitServerToCreate(explicit ? server : undefined)) return;
    if (!requireSession()) return;
    await requireCompatibleServer(); // crear un proyecto es escribir (ADR-0060)
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
      { slug: project.slug, ...serverField() },
      (created
        ? `Project "${project.name}" (${project.visibility}) created and linked · slug: ${project.slug}`
        : `"${project.name}" (${project.visibility}) already existed; linked · slug: ${project.slug}`) + `\n  on ${apiBase()}`,
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
    write(
      { slug: res.data.project.slug, ...serverField() },
      `Linked to "${res.data.project.name}" · slug: ${res.data.project.slug}\n  on ${apiBase()}`,
    );
    return;
  }

  // Sin argumentos: estado actual + qué proyectos hay disponibles.
  const link = useProjectServer(TARGET_CWD);
  if (!link) console.log("This folder is NOT linked to any project (there is no .cortex.json).");
  else if (link.ignore) console.log("This folder is marked as IGNORED for Cortex.");
  else console.log(`Linked to: ${link.slug ?? link.project ?? "(incomplete link)"}  ·  on ${apiBase()}`);

  if (!readCredentials(apiBase())) {
    console.log(`\nSign in to see your projects:  cortex auth login --server ${apiBase()}`);
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
  // Un proyecto puede no tener slug: los creados antes de que el slug existiera siguen ahí.
  // Sin esto, `cortex link` revienta entero por un dato viejo en vez de listar lo demás.
  const slugOf = (p: { slug?: string | null }): string => p.slug ?? "(no slug)";
  const w = Math.max(...projects.map((p) => slugOf(p).length));
  for (const p of projects) console.log(`  ${slugOf(p).padEnd(w)}  ${p.name}${p.visibility === "private" ? " (private)" : ""}`);
}
