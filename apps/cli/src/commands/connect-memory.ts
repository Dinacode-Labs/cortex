import { join, resolve } from "node:path";
import {
  apiBase,
  apiPost,
  claudeMemoryFolder,
  claudeProjectFolder,
  getClientConfig,
  memoryUpload,
  readClaudeMemory,
  useProjectServer,
  type ClaudeMemoryNote,
  type MemoryUpload,
} from "@cortex/client";
import { requireCompatibleServer } from "../compat.js";

/**
 * What Claude Code has learned about a repository, into its project (ADR-0095). Each note
 * becomes a memo that counts as true and waits in Review until a person checks it; the notes
 * stay where they are.
 *
 *   cortex connect-memory                    this repo's notes, into its linked project
 *   cortex connect-memory <slug> <path>      a repo's notes, or a memory folder, into a project
 *   --dry-run                                say what would go, send nothing
 *   --include-user                           send the notes about you as well
 */

const BATCH = Number(process.env.CORTEX_CAPTURE_CHUNK ?? "50");

export async function run(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const explicit = positional.length >= 2;
  const cwd = process.env.INIT_CWD || process.cwd();
  // The server comes from the folder the command runs in (ADR-0033); the notes live in ~/.claude.
  const link = useProjectServer(cwd);

  const slug = explicit ? positional[0]! : link?.slug;
  if (!slug) {
    console.error("This folder is not linked to a project, so there is nowhere to send the notes.");
    console.error("  cortex link <slug>                        link it, then run this again");
    console.error('  cortex connect-memory "<slug>" <path>     or say both explicitly');
    process.exitCode = 1;
    return;
  }

  const from = explicit ? resolve(positional[1]!) : cwd;
  const folder = claudeMemoryFolder(from);
  if (!folder) {
    console.error(`Claude Code keeps no memory for ${from}.`);
    console.error(`  Looked in ${join(claudeProjectFolder(from), "memory")}, and above it within the repository.`);
    process.exitCode = 1;
    return;
  }

  let notes: ClaudeMemoryNote[];
  try {
    notes = readClaudeMemory(folder);
  } catch (e) {
    console.error(`Could not read ${folder}: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const upload = memoryUpload(notes, { includeUser: args.includes("--include-user") });

  console.log(`Claude Code's memory: ${folder}`);
  if (dryRun) {
    printPlan(upload, slug);
    printLeftOut(upload);
    return;
  }
  if (upload.items.length === 0) {
    console.log("No note to send.");
    printLeftOut(upload);
    return;
  }

  await requireCompatibleServer();
  console.log(`${plural(upload.items.length, "note")} → "${slug}"…`);

  const idOf = new Map<string, string>();
  let added = 0;
  for (let i = 0; i < upload.items.length; i += BATCH) {
    const r = await apiPost<{ results?: { ref: string | null; id: string; action: string }[]; error?: string }>(
      "/capture/batch",
      { slug, items: upload.items.slice(i, i + BATCH) },
    );
    if (!r.ok) {
      console.error(`Capture failed (${r.status}): ${r.data.error ?? `is "${slug}" a project you belong to, and are you signed in?`}`);
      process.exitCode = 1;
      return;
    }
    for (const x of r.data.results ?? []) {
      if (x.ref) idOf.set(x.ref, x.id);
      if (x.action === "added") added++;
    }
  }

  let linked = 0;
  for (const { from: source, to } of upload.links) {
    const sourceId = idOf.get(source);
    const targetId = idOf.get(to);
    if (!sourceId || !targetId) continue;
    const r = await apiPost("/relate", { sourceId, targetId, relationType: "related_to" });
    if (r.ok) linked++;
  }

  const known = upload.items.length - added;
  console.log(
    `${added} new, ${known} already known` + (upload.links.length ? `, ${plural(linked, "link")} between them.` : "."),
  );
  printLeftOut(upload);
  if (added > 0) {
    const web = process.env.CORTEX_WEB_URL?.trim() || (await getClientConfig(apiBase()))?.webUrl;
    console.log("\nThey count as true from now on, and wait in Review until someone on the project checks them.");
    if (web) console.log(`  ${web.replace(/\/$/, "")}/p/${slug}/review?lane=new`);
  }
  console.log(`\nNothing in ${folder} was changed: Claude Code keeps its own copy.`);
}

function printPlan(upload: MemoryUpload, slug: string): void {
  console.log(`${plural(upload.items.length, "note")} would go to "${slug}" (--dry-run: nothing sent).\n`);
  for (const item of upload.items) {
    console.log(`  ${(item.type ?? "typed on arrival").padEnd(16)}  ${item.title}`);
  }
  if (upload.links.length) console.log(`\n  ${plural(upload.links.length, "link")} between them would become relations.`);
}

function printLeftOut(upload: MemoryUpload): void {
  const aboutYou = upload.leftOut.filter((x) => x.reason === "about-you").length;
  const empty = upload.leftOut.filter((x) => x.reason === "empty").length;
  if (aboutYou) {
    console.log(`Left out: ${plural(aboutYou, "note")} about you rather than the project. --include-user sends them too.`);
  }
  if (empty) console.log(`Left out: ${plural(empty, "note")} with nothing below the header.`);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
