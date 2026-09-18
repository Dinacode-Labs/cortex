import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { extractFileText } from "@cortex/core";
import { sendCondensedSession } from "@cortex/client";
import { shutdownObservability, wireLlm } from "@cortex/agents";

/**
 * The MEETINGS connector: it transcribes recordings (audio/video, through `extract`) and,
 * instead of storing the raw transcript, **distills** it into typed knowledge (decisions,
 * incidents, agreements...) by reusing the capture pipeline (distiller + reconciliation +
 * authenticated API -> attribution/permissions). A one-hour meeting -> a few useful entries.
 *
 * Usage: cortex-admin connect-meeting "<slug>" <file|folder>
 * It needs `cortex auth login`, a running server and ffmpeg (for A/V).
 */
const AV = new Set(["opus", "mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "amr", "weba", "mpga", "mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv"]);

function walk(p: string): string[] {
  if (!statSync(p).isDirectory()) return AV.has(extname(p).slice(1).toLowerCase()) ? [p] : [];
  const out: string[] = [];
  for (const n of readdirSync(p)) out.push(...walk(join(p, n)));
  return out;
}

export async function run(args: string[]): Promise<void> {
  wireLlm();
  try {
    await runMeeting(args[0], args[1]);
  } finally {
    await shutdownObservability();
  }
}

async function runMeeting(slug: string | undefined, path: string | undefined): Promise<void> {
  if (!slug || !path) {
    console.error('Usage: cortex-admin connect-meeting "<slug>" <audio/video-file|folder>');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(path)) {
    console.error(`It does not exist: ${path}`);
    process.exitCode = 1;
    return;
  }
  const files = walk(resolve(path));
  console.log(`${files.length} recording(s). Transcribing + distilling → "${slug}" (through the API)...`);

  let saved = 0;
  let updated = 0;
  let superseded = 0;
  let failed = 0;
  for (const file of files) {
    const ex = await extractFileText(file); // transcribe (whisper + ffmpeg, with chunking)
    if (!ex || ex.text.length < 200) {
      console.log(`  ${basename(file)}: no usable transcription`);
      continue;
    }
    // The server distills (ADR-0025); we wait here because the user is watching the counters.
    const r = await sendCondensedSession({
      slug,
      condensed: ex.text,
      sessionId: basename(file),
      platform: "meeting",
      sourceType: "meeting_transcript",
      wait: true,
    });
    const c = r.counters ?? { saved: 0, updated: 0, superseded: 0, noop: 0, failed: 0, windows: 0 };
    saved += c.saved;
    updated += c.updated;
    superseded += c.superseded;
    failed += c.failed;
    console.log(`  ${basename(file)}: +${c.saved} new, ~${c.updated} merged, ⊘${c.superseded} superseded${c.failed ? `, ${c.failed} failed` : ""}`);
  }
  console.log(`Meetings: +${saved} new, ~${updated} UPDATE, ⊘${superseded} SUPERSEDE${failed ? `, ${failed} failed (is the server running, and are you signed in?)` : ""}.`);
}


