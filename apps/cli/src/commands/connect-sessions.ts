import { runSessionsBackfill, shutdownObservability, wireLlm } from "@cortex/agents";

/** Backfill de sesiones de un agente a un proyecto (destila, no ingiere en crudo). */
export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  const repoPath = args[1];
  const platform = (args[2] ?? "claude").toLowerCase();
  if (!slug || !repoPath) {
    console.error('Uso: cortex connect-sessions "<slug>" <ruta-repo> [claude|codex|opencode|hermes]');
    process.exitCode = 1;
    return;
  }
  if (!["claude", "codex", "opencode", "hermes"].includes(platform)) {
    console.error(`Plataforma "${platform}" no soportada (claude|codex|opencode|hermes).`);
    process.exitCode = 1;
    return;
  }
  wireLlm();
  try {
    await runSessionsBackfill(slug, repoPath, platform);
  } finally {
    await shutdownObservability();
  }
}
