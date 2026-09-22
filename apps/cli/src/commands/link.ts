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
 * `cortex link`: links the current folder to a Cortex project by writing `.cortex.json`. It is
 * the DELIBERATE act that connects a repo (an inverse gate: with no link nothing is injected
 * and nothing is captured). Creating is not linking: `--create` creates the project and links.
 *
 *   cortex link <slug>                 link to an EXISTING project
 *   cortex link --create "<Name>"      create the project and link
 *   cortex link --ignore               opt out: this repo does NOT use Cortex
 *   cortex link                        see the current link and the available projects
 *
 * With `--server` it links to a Cortex other than the default, and the `.cortex.json` keeps it
 * (ADR-0033). With several servers configured, `--create` REQUIRES saying which: it is the one
 * point in the flow where somebody could create a client's project on another's server, and
 * from then on there would be no way to notice.
 *
 * It goes through the API rather than the database (ADR-0025): it was the last CLI command that
 * needed Postgres, and while it needed it no lightweight client could be shipped.
 */

// `pnpm --filter` changes the cwd to the package; INIT_CWD keeps the user's.
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
 * Which server this operation goes to: whatever `--server` says, failing that whatever the repo
 * already said, failing that the default. It also returns whether it was explicit, which is
 * what decides whether the `.cortex.json` stores the server or stays on the default.
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

/** With several sessions, creating without saying where is the expensive mistake. It stops first. */
function requireExplicitServerToCreate(server: string | undefined): boolean {
  const sessions = listCredentials();
  if (server || sessions.length <= 1) return true;
  console.error("✗ You are signed in to more than one Cortex. Say which one should hold this project:\n");
  for (const c of sessions) console.error(`    cortex link --create "<Name>" --server ${c.server}${c.server === defaultServer() ? "   (default)" : ""}`);
  console.error("\n  Nothing was created. Creating it on the wrong server is not something you would notice later.");
  process.exitCode = 1;
  return false;
}

function askAccess(name: string, admins?: string[]): string {
  const quien = admins?.length ? ` (${admins.join(", ")})` : "";
  return `✗ The project "${name}" exists but is private and you do not have access.\n  Ask an administrator${quien} for access. Nothing was created.`;
}

export async function run(args: string[]): Promise<void> {
  // The values of --server and --parent are not project names.
  const consumidos = new Set<string>();
  for (const f of ["--server", "--parent"]) {
    const i = args.indexOf(f);
    if (i >= 0 && args[i + 1]) consumidos.add(args[i + 1]!);
  }
  const positional = args.filter((a) => !a.startsWith("--") && !consumidos.has(a));
  const { server, explicit } = resolveServer(args);
  /** The server is only stored in .cortex.json when it is NOT the default one. */
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
    await requireCompatibleServer(); // creating a project is a write (ADR-0062)
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

  // With no arguments: the current state plus which projects are available.
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
  // A project may have no slug: the ones created before slugs existed are still there.
  // Without this, `cortex link` blows up entirely over one old row instead of listing the rest.
  const slugOf = (p: { slug?: string | null }): string => p.slug ?? "(no slug)";
  const w = Math.max(...projects.map((p) => slugOf(p).length));
  for (const p of projects) console.log(`  ${slugOf(p).padEnd(w)}  ${p.name}${p.visibility === "private" ? " (private)" : ""}`);
}
