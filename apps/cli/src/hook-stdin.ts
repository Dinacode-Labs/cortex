/**
 * Reading the JSON the hooks receive on stdin, with a time cap.
 *
 * Claude Code and Codex write the JSON and **close** the pipe, so a `for await` over
 * `process.stdin` ends on its own. Pi -- and anyone invoking the CLI with `execFile` -- leaves
 * stdin open and silent: the loop never ends, the hook dies on the caller's timeout and the
 * agent starts with no context without anybody noticing. That is how Pi was broken.
 *
 * Hence the cap: if nothing has arrived within `timeoutMs`, there is nothing to read. Whoever
 * already knows what they need (they pass `--cwd`/`--session`) should not even call here.
 */
export async function readHookStdin(timeoutMs = 2000): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  const reader = (async () => {
    for await (const c of process.stdin) chunks.push(c as Buffer);
  })().catch(() => {});

  let cutoff: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    reader,
    new Promise<void>((resolve) => {
      cutoff = setTimeout(resolve, timeoutMs);
      cutoff.unref?.();
    }),
  ]);
  if (cutoff) clearTimeout(cutoff);
  process.stdin.pause(); // if it was cut off by time, do not let it keep flowing

  return Buffer.concat(chunks).toString("utf8");
}
