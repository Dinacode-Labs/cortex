import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, readCortexLink } from "../packages/core/src/project-config";

describe("slugify", () => {
  it("genera slugs estables (kebab, sin acentos)", () => {
    expect(slugify("Acme Portal")).toBe("acme-portal");
    expect(slugify("Ñandú Pasión")).toBe("nandu-pasion");
    expect(slugify("  Acme  API  ")).toBe("acme-api");
  });
  it("vacío/sin alfanuméricos → 'proyecto'", () => {
    expect(slugify("")).toBe("proyecto");
    expect(slugify("@@@ ---")).toBe("proyecto");
  });
});

describe("readCortexLink (.cortex.json, el más cercano manda)", () => {
  const make = (): string => mkdtempSync(join(tmpdir(), "cortex-cfg-"));

  it("lee slug del directorio", () => {
    const dir = make();
    writeFileSync(join(dir, ".cortex.json"), JSON.stringify({ slug: "ce-portal" }));
    expect(readCortexLink(dir)).toEqual({ slug: "ce-portal" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("hereda el .cortex.json del padre en subdirectorios", () => {
    const dir = make();
    writeFileSync(join(dir, ".cortex.json"), JSON.stringify({ slug: "padre" }));
    const sub = join(dir, "a", "b");
    mkdirSync(sub, { recursive: true });
    expect(readCortexLink(sub)?.slug).toBe("padre");
    rmSync(dir, { recursive: true, force: true });
  });

  it("opt-out con { ignore: true }", () => {
    const dir = make();
    writeFileSync(join(dir, ".cortex.json"), JSON.stringify({ ignore: true }));
    expect(readCortexLink(dir)).toEqual({ ignore: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("sin .cortex.json → null", () => {
    const dir = make();
    expect(readCortexLink(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("JSON inválido → null (no rompe)", () => {
    const dir = make();
    writeFileSync(join(dir, ".cortex.json"), "{ no json");
    expect(readCortexLink(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
