import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { BatchItem } from "@cortex/shared";

/**
 * Claude Code's own memory of a repository: one Markdown note per fact under
 * `~/.claude/projects/<repo path>/memory/`, and `MEMORY.md`, the index it loads into every
 * session. It comes into the project as memos for a person to check (ADR-0095).
 */

export type ClaudeMemoryKind = "user" | "feedback" | "project" | "reference";

export interface ClaudeMemoryNote {
  file: string;
  name: string;
  description: string;
  kind: ClaudeMemoryKind | null;
  title: string;
  body: string;
}

export interface MemoryUpload {
  items: BatchItem[];
  /** Pairs of `sourceReference`s, from the note holding the `[[link]]` to the note it names. */
  links: { from: string; to: string }[];
  leftOut: { note: ClaudeMemoryNote; reason: "about-you" | "empty" }[];
}

const INDEX_FILE = "MEMORY.md";
const KINDS: readonly string[] = ["user", "feedback", "project", "reference"];
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const LINK = /\[\[([^\]\n]+)\]\]/g;

export function claudeProjectFolder(repoPath: string, home = homedir()): string {
  return join(home, ".claude/projects", repoPath.replace(/[^a-zA-Z0-9]/g, "-"));
}

/**
 * The path is either the memory folder itself, which holds the index, or a folder of a
 * repository. It walks up no further than the repository's root: above it lies the memory of
 * whatever encloses the repository, often the home folder's, which belongs to no project.
 */
export function claudeMemoryFolder(path: string, home = homedir()): string | null {
  if (existsSync(join(path, INDEX_FILE))) return path;
  const root = repositoryRoot(path);
  for (let dir = path; ; dir = dirname(dir)) {
    const folder = join(claudeProjectFolder(dir, home), "memory");
    if (existsSync(folder)) return folder;
    if (!root || dir === root || dirname(dir) === dir) return null;
  }
}

function repositoryRoot(path: string): string | null {
  for (let dir = path; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Only the YAML Claude Code writes: `key: value` lines and one level of nesting. */
export function parseFrontmatter(text: string): { fields: Map<string, string>; body: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!block) return { fields: new Map(), body: text };
  const fields = new Map<string, string>();
  let parent = "";
  for (const line of block[1]!.split(/\r?\n/)) {
    const pair = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[2]!;
    const value = unquote(pair[3]!.trim());
    if (pair[1]) {
      if (parent) fields.set(`${parent}.${key}`, value);
      continue;
    }
    parent = value ? "" : key;
    if (value) fields.set(key, value);
  }
  return { fields, body: text.slice(block[0].length) };
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

function indexTitles(folder: string): Map<string, string> {
  const titles = new Map<string, string>();
  const index = join(folder, INDEX_FILE);
  if (!existsSync(index)) return titles;
  for (const m of readFileSync(index, "utf8").matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+\.md)\)/gm)) {
    titles.set(basename(m[2]!), m[1]!.trim());
  }
  return titles;
}

export function readClaudeMemory(folder: string): ClaudeMemoryNote[] {
  const titles = indexTitles(folder);
  return readdirSync(folder)
    .filter((file) => file.endsWith(".md") && file !== INDEX_FILE && !file.startsWith("."))
    .sort()
    .map((file) => toNote(file, readFileSync(join(folder, file), "utf8"), titles.get(file)));
}

export function toNote(file: string, text: string, indexTitle?: string): ClaudeMemoryNote {
  const { fields, body } = parseFrontmatter(text);
  const name = fields.get("name") || stem(file);
  const description = fields.get("description") ?? "";
  // Older notes carry `type` at the top; newer ones nest it under `metadata`.
  const kind = fields.get("metadata.type") ?? fields.get("type") ?? "";
  // `name` is a slug in newer notes and a sentence in older ones.
  const title = indexTitle || (SLUG.test(name) ? description || humanize(name) : name);
  return {
    file,
    name,
    description,
    kind: KINDS.includes(kind) ? (kind as ClaudeMemoryKind) : null,
    title,
    body: body.trim(),
  };
}

function stem(file: string): string {
  return file.replace(/\.md$/, "");
}

function humanize(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The reference carries a hash of the note, so a run recognises the notes it already sent, a
 * note that changed goes in as a new memo, and the same note from two people is one (ADR-0095).
 */
export function memoryReference(note: ClaudeMemoryNote): string {
  const hash = createHash("sha256").update(`${note.name}\n${note.description}\n${note.body}`).digest("hex");
  return `claude-memory/${note.file}#${hash.slice(0, 12)}`;
}

export function memoryUpload(notes: ClaudeMemoryNote[], opts: { includeUser?: boolean } = {}): MemoryUpload {
  const leftOut: MemoryUpload["leftOut"] = [];
  const sent: ClaudeMemoryNote[] = [];
  for (const note of notes) {
    if (!note.body) leftOut.push({ note, reason: "empty" });
    else if (note.kind === "user" && !opts.includeUser) leftOut.push({ note, reason: "about-you" });
    else sent.push(note);
  }

  const titleOf = new Map<string, string>();
  for (const note of notes) titleOf.set(stem(note.file), note.title).set(note.name, note.title);
  const refOf = new Map<string, string>();
  for (const note of sent) {
    const ref = memoryReference(note);
    refOf.set(stem(note.file), ref).set(note.name, ref);
  }

  const items: BatchItem[] = [];
  const links = new Map<string, { from: string; to: string }>();
  for (const note of sent) {
    const ref = memoryReference(note);
    for (const [, target] of note.body.matchAll(LINK)) {
      const to = refOf.get(target!.trim());
      if (to && to !== ref) links.set(`${ref} ${to}`, { from: ref, to });
    }
    items.push({
      title: note.title.slice(0, 200),
      content: note.body.replace(LINK, (_, target: string) => titleOf.get(target.trim()) ?? target.trim()),
      ...(note.description ? { summary: note.description } : {}),
      // Feedback is how the agent should work here, which is what a convention is; the rest is
      // typed on arrival, like anything else a connector sends.
      ...(note.kind === "feedback" ? { type: "convention" } : {}),
      // Written by a model: it enters low and a person's verdict in Review raises it.
      confidence: "low",
      sourceType: "claude_code",
      sourceReference: ref,
      metadata: { platform: "claude", memoryFile: note.file, ...(note.kind ? { memoryKind: note.kind } : {}) },
    });
  }
  return { items, links: [...links.values()], leftOut };
}
