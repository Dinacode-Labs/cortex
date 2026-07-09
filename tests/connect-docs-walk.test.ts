import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { walk } from "../apps/cli/src/commands/connect-docs";

/**
 * connect-docs recorre una carpeta e ingiere los ficheros soportados. Debe SALTAR los
 * directorios de dependencias/artefactos (node_modules, vendor, dist…) y los dotfiles:
 * sin eso, apuntar el conector a la raíz de un repo mete basura de `vendor/` (fixtures de
 * php_codesniffer, etc.) en la memoria. Este test fija ese contrato.
 */
describe("connect-docs walk — ignora dependencias y dotfiles", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-walk-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const file = (rel: string, body = "contenido de prueba suficientemente largo") => {
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
  file("logo.svg"); // extensión no soportada

  const found = walk(root).map((p) => basename(p)).sort();

  it("incluye solo los ficheros soportados fuera de dirs ignorados", () => {
    expect(found).toEqual(["guia.md", "informe.pdf", "notas.txt"]);
  });

  it("no incluye nada bajo node_modules/vendor/dist ni dotdirs", () => {
    expect(found).not.toContain("readme.md");
    expect(found).not.toContain("fixture.xml");
    expect(found).not.toContain("bundle.md");
    expect(found).not.toContain("secreto.md");
  });
});
