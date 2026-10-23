import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeMemoryFolder,
  claudeProjectFolder,
  memoryReference,
  memoryUpload,
  readClaudeMemory,
  toNote,
} from "../packages/client/src/claude-memory";

/**
 * `cortex connect-memory` reads Claude Code's own notes (ADR-0095). Sent as plain documents, the
 * index went in as one more memo, every memo carried the YAML header in its text, a re-run said
 * "already known" about a note that had changed, and `[[links]]` reached the pack as brackets.
 */

const note = (fields: string, body: string): string => `---\n${fields}\n---\n\n${body}\n`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-claude-memory-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reading a note", () => {
  // Claude Code moved `type` under `metadata`; a folder holds notes from before and after.
  it("takes its kind from either shape of header", () => {
    const newer = toNote("a.md", note("name: a\ndescription: d\nmetadata:\n  node_type: memory\n  type: feedback", "Body."));
    const older = toNote("b.md", note("name: Known race in the importer\ndescription: d\ntype: project", "Body."));
    expect([newer.kind, older.kind]).toEqual(["feedback", "project"]);
    expect(newer.body, "the header is not part of what the memo says").toBe("Body.");
  });

  it("names the memo after the index, then the note's own name when it is a sentence", () => {
    expect(toNote("a.md", note("name: main-requires-pr\ndescription: d", "x"), "main requires a PR").title).toBe("main requires a PR");
    expect(toNote("b.md", note("name: Known race in the importer\ndescription: d", "x")).title).toBe("Known race in the importer");
    expect(toNote("c.md", note("name: some-slug\ndescription: What it is about", "x")).title).toBe("What it is about");
    expect(toNote("plain-note.md", "Just text, no header.").title).toBe("Plain note");
  });
});

describe("the folder", () => {
  // MEMORY.md is what Claude Code loads into every session: as a memo it repeated every title.
  it("leaves the index out and uses its titles", () => {
    writeFileSync(join(dir, "MEMORY.md"), "- [Releases come from main](releases.md) — tags only\n");
    writeFileSync(join(dir, "releases.md"), note("name: releases\ndescription: d\nmetadata:\n  type: project", "Tags only."));
    const notes = readClaudeMemory(dir);
    expect(notes.map((n) => [n.file, n.title])).toEqual([["releases.md", "Releases come from main"]]);
  });

  // Above the repository lies the memory of the home folder, which belongs to no project.
  it("is found from a subfolder of the repository, and never above its root", () => {
    const home = join(dir, "home");
    const repo = join(dir, "work", "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    mkdirSync(join(claudeProjectFolder(join(dir, "work"), home), "memory"), { recursive: true });
    expect(claudeMemoryFolder(join(repo, "src", "deep"), home)).toBeNull();

    mkdirSync(join(claudeProjectFolder(repo, home), "memory"), { recursive: true });
    expect(claudeMemoryFolder(join(repo, "src", "deep"), home)).toBe(join(claudeProjectFolder(repo, home), "memory"));
  });

  it("is the path itself when the path holds the index", () => {
    writeFileSync(join(dir, "MEMORY.md"), "");
    expect(claudeMemoryFolder(dir, join(dir, "home"))).toBe(dir);
  });

  it("is named after the repository's path the way Claude Code names it", () => {
    expect(claudeProjectFolder("/home/ana/my.repo", "/h")).toBe("/h/.claude/projects/-home-ana-my-repo");
  });
});

describe("what goes to the project", () => {
  const notes = [
    toNote("conv.md", note("name: conv\ndescription: Tests before merging\nmetadata:\n  type: feedback", "Run the tests. See [[deploy]].")),
    toNote("deploy.md", note("name: deploy\ndescription: How it ships\nmetadata:\n  type: project", "Ships from main.")),
    toNote("me.md", note("name: me\ndescription: Who the user is\nmetadata:\n  type: user", "A backend developer.")),
    toNote("blank.md", note("name: blank\ndescription: d", "")),
  ];

  // A note about the person would be told to every agent on the team.
  it("leaves out the notes about the person unless asked", () => {
    const by = (u: ReturnType<typeof memoryUpload>) => u.items.map((i) => i.metadata?.memoryFile);
    expect(by(memoryUpload(notes))).toEqual(["conv.md", "deploy.md"]);
    expect(by(memoryUpload(notes, { includeUser: true }))).toEqual(["conv.md", "deploy.md", "me.md"]);
    expect(memoryUpload(notes).leftOut.map((x) => [x.note.file, x.reason])).toEqual([
      ["me.md", "about-you"],
      ["blank.md", "empty"],
    ]);
  });

  // A model wrote them: they wait for a person instead of entering as checked facts.
  it("goes in low, from Claude Code, with the description as its summary", () => {
    const [conv, deploy] = memoryUpload(notes).items;
    expect(conv).toMatchObject({ type: "convention", confidence: "low", sourceType: "claude_code", summary: "Tests before merging" });
    expect(deploy!.type, "only the server types a project note").toBeUndefined();
  });

  it("reads a [[link]] as the title of the note it names, and keeps it as a relation", () => {
    const upload = memoryUpload(notes);
    expect(upload.items[0]!.content).toBe("Run the tests. See How it ships.");
    expect(upload.links).toEqual([{ from: memoryReference(notes[0]!), to: memoryReference(notes[1]!) }]);
  });

  // Without the hash, a note that changed was "already known" and its new text never arrived.
  it("is recognised on the next run, and a change makes it a new memo", () => {
    const again = toNote("deploy.md", note("name: deploy\ndescription: How it ships\nmetadata:\n  type: project", "Ships from main."));
    const changed = toNote("deploy.md", note("name: deploy\ndescription: How it ships\nmetadata:\n  type: project", "Ships from tags."));
    expect(memoryReference(again)).toBe(memoryReference(notes[1]!));
    expect(memoryReference(changed)).not.toBe(memoryReference(notes[1]!));
  });
});
