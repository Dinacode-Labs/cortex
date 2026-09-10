import { backfillSessions, type CapturePlatformName } from "@cortex/client";

/**
 * Backfill retroactivo de las sesiones de un agente hacia un proyecto. Condensa cada
 * transcript y lo manda al servidor, que lo destila (ADR-0025): no se ingiere el crudo y
 * este comando ya no necesita clave de LLM.
 */
const PLATAFORMAS = ["claude", "codex", "opencode", "hermes", "pi"] as const;

export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  const repoPath = args[1];
  const platform = (args[2] ?? "claude").toLowerCase();
  if (!slug || !repoPath) {
    console.error('Usage: cortex connect-sessions "<slug>" <repo-path> [claude|codex|opencode|hermes|pi]');
    process.exitCode = 1;
    return;
  }
  if (!(PLATAFORMAS as readonly string[]).includes(platform)) {
    console.error(`Unsupported agent "${platform}" (${PLATAFORMAS.join("|")}).`);
    process.exitCode = 1;
    return;
  }
  const limit = process.env.CORTEX_SESSIONS_LIMIT ? Number(process.env.CORTEX_SESSIONS_LIMIT) : undefined;
  await backfillSessions(slug, repoPath, platform as CapturePlatformName, { limit });
}
