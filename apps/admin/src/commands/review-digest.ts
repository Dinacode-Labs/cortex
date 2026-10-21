import { sendReviewDigests } from "@cortex/core";

export async function run(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const result = await sendReviewDigests({ dryRun });
  if (dryRun) {
    for (const email of result.previews) console.log(`--- to ${email.to} · ${email.subject}\n${email.text}\n`);
    console.log(`[digest] ${result.previews.length} would be sent. Dry run: nothing was sent or recorded.`);
    return;
  }
  console.log(`[digest] ${result.sent.length} sent, ${result.failed.length} failed.`);
  for (const failure of result.failed) console.error(`  ${failure.email}: ${failure.error}`);
  if (result.failed.length > 0) process.exitCode = 1;
}
