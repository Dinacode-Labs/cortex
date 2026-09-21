import { resummarizeEntries } from "@cortex/core";
import { shutdownObservability, wireLlm } from "@cortex/agents";

/**
 * Rebuilds the stored summary of the CURRENT entries whose summary is just a cut of their
 * content -- what the heuristic produced before it learned to take the Markdown out and stop
 * at a sentence -- with the LLM when one is configured and with the heuristic when it is not.
 *
 * It is for what is ALREADY stored: a memory is mostly made of entries nobody is going to
 * re-ingest, and the summary is what the agent reads when a session opens.
 *
 * Every rewrite moves the entry's `updated_at`, which the `context_entries` trigger sets on
 * any UPDATE. That movement no longer decides anything by itself -- confidence is counted from
 * corroborations (ADR-0067) -- but this is a bulk write over a whole project, so --dry-run
 * first.
 *
 * Usage: cortex-admin resummarize [--project "<slug-or-name>"] [--dry-run]
 */
export async function run(args: string[]): Promise<void> {
  wireLlm();
  try {
    await resummarize(args);
  } finally {
    await shutdownObservability();
  }
}

const SAMPLES = 10;

async function resummarize(args: string[]): Promise<void> {
  let project: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--project") project = args[++i];
    else if (arg.startsWith("--project=")) project = arg.slice("--project=".length);
    else {
      console.error(`Unknown argument: "${arg}"`);
      console.error('Usage: cortex-admin resummarize [--project "<slug-or-name>"] [--dry-run]');
      process.exitCode = 1;
      return;
    }
  }
  if (project === undefined && args.includes("--project")) {
    console.error('Usage: cortex-admin resummarize [--project "<slug-or-name>"] [--dry-run]');
    process.exitCode = 1;
    return;
  }

  console.log(`Re-summarising ${project ? `"${project}"` : "every project"}${dryRun ? " (dry run)" : ""}...`);
  let shown = 0;
  const r = await resummarizeEntries({
    project,
    dryRun,
    onRewrite: ({ title, before, after }) => {
      if (shown++ >= SAMPLES) return;
      console.log(`  ${title}\n    - ${before ?? "(none)"}\n    + ${after}`);
    },
  });
  if (r.rewritten > SAMPLES) console.log(`  ...and ${r.rewritten - SAMPLES} more.`);
  console.log(
    dryRun
      ? `${r.rewritten} of ${r.scanned} current entries would change. Nothing was written.`
      : `${r.rewritten} of ${r.scanned} current entries re-summarised.`,
  );
}
