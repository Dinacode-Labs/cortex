import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFileText } from "../packages/core/src/capture/extract";
import { SUPPORTED_EXTS } from "@cortex/shared";

/**
 * The `extract` layer is used by the document connectors (connect-docs walks a folder and only
 * considers files whose extension is in SUPPORTED_EXTS). Plain text and Markdown are the most
 * common format for project docs, so they must be ingested as is (they need no binary
 * parsing). These tests pin that contract.
 */
describe("extractFileText — plain text / Markdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "cortex-extract-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, body: string): string => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  it("incluye md/markdown/txt/text en SUPPORTED_EXTS", () => {
    for (const ext of ["md", "markdown", "txt", "text"]) {
      expect(SUPPORTED_EXTS.has(ext)).toBe(true);
    }
  });

  it("reads a .md as is and reports the format", async () => {
    const p = write("note.md", "# Decision\n\nRabbitMQ is used for asynchronous exports.");
    const ex = await extractFileText(p);
    expect(ex).not.toBeNull();
    expect(ex!.format).toBe("md");
    expect(ex!.text).toContain("RabbitMQ");
  });

  it("reads a .txt as is", async () => {
    const p = write("audit.txt", "Notifications audit: email + push reviewed.");
    const ex = await extractFileText(p);
    expect(ex!.text).toContain("Notifications");
  });

  it("returns null when the file is empty", async () => {
    const p = write("empty.md", "   \n\n  ");
    expect(await extractFileText(p)).toBeNull();
  });
});
