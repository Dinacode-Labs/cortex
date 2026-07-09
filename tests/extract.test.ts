import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFileText, SUPPORTED_EXTS } from "../packages/core/src/extract";

/**
 * La capa `extract` la usan los conectores de documentos (connect-docs recorre una
 * carpeta y solo considera ficheros con extensión en SUPPORTED_EXTS). El texto plano y
 * el Markdown son el formato más común de docs de proyecto, así que deben ingerirse tal
 * cual (no requieren parseo binario). Estos tests fijan ese contrato.
 */
describe("extractFileText — texto plano / Markdown", () => {
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

  it("lee un .md tal cual y reporta el formato", async () => {
    const p = write("nota.md", "# Decisión\n\nSe usa RabbitMQ para exportaciones asíncronas.");
    const ex = await extractFileText(p);
    expect(ex).not.toBeNull();
    expect(ex!.format).toBe("md");
    expect(ex!.text).toContain("RabbitMQ");
  });

  it("lee un .txt tal cual", async () => {
    const p = write("auditoria.txt", "Auditoría de notificaciones: email + push revisados.");
    const ex = await extractFileText(p);
    expect(ex!.text).toContain("notificaciones");
  });

  it("devuelve null si el fichero está vacío", async () => {
    const p = write("vacio.md", "   \n\n  ");
    expect(await extractFileText(p)).toBeNull();
  });
});
