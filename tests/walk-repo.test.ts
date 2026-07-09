import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkRepo } from "../packages/core/src/code";

/**
 * walkRepo alimenta la indexación de código (search_project_code). Debe saltar tanto los
 * dirs de dependencias/artefactos (IGNORE_DIRS) como las RUTAS generadas por frameworks
 * (var/cache de Symfony, storage/framework de Laravel…). Sin esto, indexar la raíz de un
 * backend Symfony mete miles de chunks de traducciones cacheadas que ensucian la búsqueda.
 */
describe("walkRepo — ignora deps y cachés de frameworks", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-repo-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const file = (rel: string, body = "<?php\nreturn ['ok' => true];\n") => {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
    return p;
  };

  // Código real
  file("src/Controller/PaymentController.php");
  file("app/service.ts", "export const x = 1;\n");
  // Generado / dependencias → excluir
  file("var/cache/local/translations/catalogue.es.php");
  file("var/log/prod.log", "log line");
  file("vendor/squizlabs/php_codesniffer/fixture.php");
  file("node_modules/pkg/index.js", "module.exports = {}");

  const rels = walkRepo(root).map((f) => f.relPath.split("\\").join("/")).sort();

  it("incluye el código de src/ y app/", () => {
    expect(rels).toContain("src/Controller/PaymentController.php");
    expect(rels).toContain("app/service.ts");
  });

  it("excluye var/cache, var/log, vendor y node_modules", () => {
    expect(rels.some((r) => r.startsWith("var/cache/"))).toBe(false);
    expect(rels.some((r) => r.startsWith("var/log/"))).toBe(false);
    expect(rels.some((r) => r.includes("/vendor/") || r.startsWith("vendor/"))).toBe(false);
    expect(rels.some((r) => r.includes("node_modules"))).toBe(false);
  });
});
