import { runMaintenance, shutdownObservability, wireLlm } from "@cortex/agents";

/** Pipeline de mantenimiento: enrich/resolve/temporal/curate/reconcile/lint. */
export async function run(args: string[]): Promise<void> {
  wireLlm();
  try {
    await runMaintenance(args[0]);
  } finally {
    await shutdownObservability();
  }
}
