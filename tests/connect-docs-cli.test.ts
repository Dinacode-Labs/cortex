import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walk } from "../apps/cli/src/commands/connect-docs.js";
import { extractionKind, IGNORE_DIRS } from "@cortex/shared";

/**
 * `connect-docs` used to live only in `cortex-admin`, which is not published to npm, so
 * ingesting a documentation folder meant cloning the whole monorepo (ADR-0058). The CLI now
 * does it with what it can read dependency-free, and it **says** what it left out: a connector
 * that keeps quiet about what it did not upload is worse than one that does not upload it.
 */
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cortex-docs-"));
  mkdirSync(join(root, "sub"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "guide.md"), "# Guide\n\nEnough content here.");
  writeFileSync(join(root, "sub", "notes.txt"), "plain text");
  writeFileSync(join(root, "manual.pdf"), "%PDF fake");
  writeFileSync(join(root, "sheet.xlsx"), "fake");
  writeFileSync(join(root, "screenshot.png"), "fake");
  writeFileSync(join(root, "binary.zip"), "fake");
  writeFileSync(join(root, ".hidden.md"), "should not get in");
  writeFileSync(join(root, "node_modules", "thing.md"), "should not get in");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("connect-docs in the lightweight CLI", () => {
  it("picks up what it can read, in any subfolder", () => {
    const found = walk(root);
    expect(found.text.map((p) => p.replace(root, "")).sort()).toEqual(["/guide.md", "/sub/notes.txt"]);
  });

  it("does not swallow node_modules or dotfiles, which is how a folder ends up in the memory", () => {
    const found = walk(root);
    const all = [...found.text, ...found.heavy].join("|");
    expect(all).not.toContain("node_modules");
    expect(all).not.toContain(".git");
    expect(all).not.toContain(".hidden");
  });

  it("counts what it CANNOT read instead of ignoring it silently", () => {
    const found = walk(root);
    expect(found.heavy.map((p) => p.replace(root, "")).sort()).toEqual(["/manual.pdf", "/screenshot.png", "/sheet.xlsx"]);
    expect(found.heavy.join("|"), "a .zip is not documentation, not even heavy documentation").not.toContain("binary.zip");
  });

  it("the classification separates what needs dependencies from what does not", () => {
    expect(extractionKind("README.md")).toBe("text");
    expect(extractionKind("notes.TXT")).toBe("text");
    expect(extractionKind("report.pdf")).toBe("heavy");
    expect(extractionKind("note.opus")).toBe("heavy");
    expect(extractionKind("binary.zip")).toBe("unsupported");
  });

  it("the directories that are never walked are still there", () => {
    for (const d of ["node_modules", "vendor", "dist", ".git"]) expect(IGNORE_DIRS.has(d)).toBe(true);
  });
});
