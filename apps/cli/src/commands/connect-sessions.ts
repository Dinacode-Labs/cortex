import { backfillSessions, readCortexLink, useProjectServer, type CapturePlatformName } from "@cortex/client";
import { requireCompatibleServer } from "../compat.js";

/**
 * Retroactive backfill: it pulls into the memory the sessions you already had with an agent in
 * this repository. The client condenses each transcript and the server distills it (ADR-0025),
 * so no model key is needed here.
 *
 * The normal way is to run it **inside the repository**, with no arguments: the project comes
 * from `.cortex.json` and the folder is the cwd. Asking for both by hand was redundant -- the
 * folder already knows which project it belongs to -- and it invited typing another project's
 * slug by mistake.
 *
 *   cortex connect-sessions                       this repo, its project, Claude Code
 *   cortex connect-sessions --platform pi         another agent
 *   cortex connect-sessions <slug> <path> [agent] the explicit form, to backfill another folder
 */
const PLATAFORMAS = ["claude", "codex", "opencode", "hermes", "pi"] as const;

function flag(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(`--${nombre}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${nombre}=`))?.split("=").slice(1).join("=");
}

export async function run(args: string[]): Promise<void> {
  const posicionales = args.filter((a) => !a.startsWith("--"));
  const explicito = posicionales.length >= 2;

  const repoPath = explicito ? posicionales[1]! : process.env.INIT_CWD || process.cwd();
  // The server comes from the FOLDER, not from the default (ADR-0033). Without this, a
  // backfill in a repo pointing at another Cortex would send its sessions to the wrong server,
  // which is exactly what that ADR exists to prevent.
  const link = useProjectServer(repoPath) ?? readCortexLink(repoPath);

  const slug = explicito ? posicionales[0]! : link?.slug;
  if (!slug) {
    console.error("This folder is not linked to a project, so there is nothing to backfill into.");
    console.error("  cortex link <slug>                            link it, then run this again");
    console.error('  cortex connect-sessions "<slug>" <repo-path>  or say both explicitly');
    process.exitCode = 1;
    return;
  }

  const platform = (flag(args, "platform") ?? posicionales[2] ?? "claude").toLowerCase();
  if (!(PLATAFORMAS as readonly string[]).includes(platform)) {
    console.error(`Unsupported agent "${platform}" (${PLATAFORMAS.join("|")}).`);
    process.exitCode = 1;
    return;
  }

  await requireCompatibleServer();
  const limit = process.env.CORTEX_SESSIONS_LIMIT ? Number(process.env.CORTEX_SESSIONS_LIMIT) : undefined;
  await backfillSessions(slug, repoPath, platform as CapturePlatformName, { limit });
}
