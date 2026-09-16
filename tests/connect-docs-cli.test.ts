import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recorre } from "../apps/cli/src/commands/connect-docs.js";
import { extractionKind, IGNORE_DIRS } from "@cortex/shared";

/**
 * `connect-docs` vivía solo en `cortex-admin`, que no se publica en npm, así que ingerir una
 * carpeta de documentación exigía clonar el monorepo entero (ADR-0058). Ahora lo hace el CLI
 * con lo que puede leer sin dependencias, y **dice** lo que ha dejado fuera: un conector que se
 * calla lo que no ha subido es peor que uno que no lo sube.
 */
let raiz: string;

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), "cortex-docs-"));
  mkdirSync(join(raiz, "sub"));
  mkdirSync(join(raiz, "node_modules"));
  mkdirSync(join(raiz, ".git"));
  writeFileSync(join(raiz, "guia.md"), "# Guía\n\nContenido suficiente.");
  writeFileSync(join(raiz, "sub", "notas.txt"), "texto plano");
  writeFileSync(join(raiz, "manual.pdf"), "%PDF falso");
  writeFileSync(join(raiz, "hoja.xlsx"), "falso");
  writeFileSync(join(raiz, "captura.png"), "falso");
  writeFileSync(join(raiz, "binario.zip"), "falso");
  writeFileSync(join(raiz, ".oculto.md"), "no debería entrar");
  writeFileSync(join(raiz, "node_modules", "cosa.md"), "no debería entrar");
});

afterAll(() => rmSync(raiz, { recursive: true, force: true }));

describe("connect-docs en el CLI ligero", () => {
  it("recoge lo que sabe leer, en cualquier subcarpeta", () => {
    const h = recorre(raiz);
    expect(h.texto.map((p) => p.replace(raiz, "")).sort()).toEqual(["/guia.md", "/sub/notas.txt"]);
  });

  it("no se traga node_modules ni los dotfiles, que es como una carpeta acaba en la memoria", () => {
    const h = recorre(raiz);
    const todo = [...h.texto, ...h.pesados].join("|");
    expect(todo).not.toContain("node_modules");
    expect(todo).not.toContain(".git");
    expect(todo).not.toContain(".oculto");
  });

  it("cuenta lo que NO puede leer en vez de ignorarlo en silencio", () => {
    const h = recorre(raiz);
    expect(h.pesados.map((p) => p.replace(raiz, "")).sort()).toEqual(["/captura.png", "/hoja.xlsx", "/manual.pdf"]);
    expect(h.pesados.join("|"), "un .zip no es documentación, ni siquiera pesada").not.toContain("binario.zip");
  });

  it("la clasificación separa lo que necesita dependencias de lo que no", () => {
    expect(extractionKind("README.md")).toBe("texto");
    expect(extractionKind("notas.TXT")).toBe("texto");
    expect(extractionKind("informe.pdf")).toBe("pesado");
    expect(extractionKind("nota.opus")).toBe("pesado");
    expect(extractionKind("binario.zip")).toBe("no-soportado");
  });

  it("los directorios que nunca se recorren siguen estando", () => {
    for (const d of ["node_modules", "vendor", "dist", ".git"]) expect(IGNORE_DIRS.has(d)).toBe(true);
  });
});
