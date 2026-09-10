import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";

/**
 * La documentación de este repo la va a leer alguien de fuera. Estas comprobaciones son las
 * que se rompen solas con el tiempo: un enlace a un fichero que se movió, un nombre de
 * cliente que se coló, o un ADR citado que nunca se escribió.
 */
const ROOT = resolve(import.meta.dirname, "..");
const DOCS = [
  "README.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "deploy/README.md",
  "config/README.md",
  ...globSync("docs/**/*.md", { cwd: ROOT }),
];

const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

describe("documentación", () => {
  it("no hay enlaces internos rotos", () => {
    const rotos: string[] = [];
    for (const doc of DOCS) {
      const dir = resolve(ROOT, doc, "..");
      for (const m of read(doc).matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]*)?\)/g)) {
        if (!existsSync(resolve(dir, m[1]!))) rotos.push(`${doc} → ${m[1]}`);
      }
    }
    expect(rotos).toEqual([]);
  });

  it("todos los ADR citados existen", () => {
    const decisions = read("docs/decisions.md");
    const existentes = new Set([...decisions.matchAll(/^## (ADR-\d{4})/gm)].map((m) => m[1]!));
    const citados = new Set<string>();
    for (const doc of DOCS) for (const m of read(doc).matchAll(/\bADR-(\d{4})\b/g)) citados.add(`ADR-${m[1]}`);
    const fantasma = [...citados].filter((a) => !existentes.has(a)).sort();
    expect(fantasma).toEqual([]);
  });

  it("no queda material corporativo: ni clientes por su nombre, ni dominios propios", () => {
    // ADR-0026 y ADR-0031: que el código se abra no significa abrir el proceso. La
    // excepción es SECURITY.md, que TIENE que decir a quién se reporta una vulnerabilidad.
    const prohibido = /\b(levelup|boluda|dinacode\.com)\b/i;
    const ofensores = DOCS.filter((d) => d !== "SECURITY.md" && prohibido.test(read(d)));
    expect(ofensores).toEqual([]);
  });

  it("el CHANGELOG mantiene una sección [Unreleased] para el próximo PR", () => {
    expect(read("CHANGELOG.md")).toContain("## [Unreleased]");
  });
});
