import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { walk } from "../apps/admin/src/commands/connect-docs";

/**
 * connect-docs walks a folder and ingests the supported files. It must SKIP the
 * dependency/artefact directories (node_modules, vendor, dist...) and the dotfiles: without
 * that, pointing the connector at a repo root puts junk from `vendor/` (php_codesniffer
 * fixtures and the like) into the memory. This test pins that contract.
 */
describe("connect-docs walk — ignora dependencias y dotfiles", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-walk-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const file = (rel: string, body = "test content long enough to count") => {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
    return p;
  };

  // Deben incluirse
  file("docs/guia.md");
  file("notas.txt");
  file("informe.pdf");
  // Deben excluirse
  file("node_modules/pkg/readme.md");
  file("wt-back-end/vendor/squizlabs/php_codesniffer/fixture.xml");
  file("dist/bundle.md");
  file(".hidden/secreto.md");
  file("logo.svg"); // unsupported extension

  const found = walk(root).map((p) => basename(p)).sort();

  it("includes only the supported files outside ignored directories", () => {
    expect(found).toEqual(["guia.md", "informe.pdf", "notas.txt"]);
  });

  it("includes nothing under node_modules/vendor/dist nor dotdirs", () => {
    expect(found).not.toContain("readme.md");
    expect(found).not.toContain("fixture.xml");
    expect(found).not.toContain("bundle.md");
    expect(found).not.toContain("secreto.md");
  });
});
