import { backfillSessions, readCortexLink, useProjectServer, type CapturePlatformName } from "@cortex/client";
import { requireCompatibleServer } from "../compat.js";

/**
 * Backfill retroactivo: mete en la memoria las sesiones que ya tenías de un agente en este
 * repositorio. El cliente condensa cada transcript y el servidor lo destila (ADR-0025), así
 * que aquí no hace falta ninguna clave de modelo.
 *
 * Lo normal es ejecutarlo **dentro del repositorio**, sin argumentos: el proyecto sale del
 * `.cortex.json` y la carpeta es el cwd. Pedir las dos cosas a mano era redundante —la
 * carpeta ya sabe a qué proyecto pertenece— y además invitaba a equivocarse escribiendo el
 * slug de otro proyecto.
 *
 *   cortex connect-sessions                      este repo, su proyecto, Claude Code
 *   cortex connect-sessions --platform pi        otro agente
 *   cortex connect-sessions <slug> <ruta> [ag]   forma explícita, para backfillear otra carpeta
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
  // El servidor sale de la CARPETA, no del por defecto (ADR-0033). Sin esto, un backfill en
  // un repo que apunta a otro Cortex mandaría sus sesiones al servidor equivocado, que es
  // exactamente lo que ese ADR existe para impedir.
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
