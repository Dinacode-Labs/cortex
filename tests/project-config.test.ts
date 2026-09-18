import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCortexLink } from "../packages/client/src/project-config";
import { slugify } from "../packages/core/src/project-config";

describe("slugify", () => {
  it("generates stable slugs (kebab-case, accents stripped)", () => {
    expect(slugify("Acme Portal")).toBe("acme-portal");
    expect(slugify("Ñandú Pasión")).toBe("nandu-pasion"); // accented input is what the corpus brings
    expect(slugify("  Acme  API  ")).toBe("acme-api");
  });
  it("empty / no alphanumerics → 'project'", () => {
    expect(slugify("")).toBe("project");
    expect(slugify("@@@ ---")).toBe("project");
  });
});

describe("readCortexLink (.cortex.json, the nearest one wins)", () => {
  const make = (): string => mkdtempSync(join(tmpdir(), "cortex-cfg-"));

  it("reads the slug from the directory", () => {
    const dir = make();
    writeFileSync(join(dir, ".cortex.json"), JSON.stringify({ slug: "ce-portal" }));
    expect(readCortexLink(dir)).toEqual({ slug: "ce-portal" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("inherits the parent's .cortex.json in subdirectories", () => {
    const dir = make();
    writeFileSync(join(dir, ".cortex.json"), JSON.stringify({ slug: "padre" }));
    const sub = join(dir, "a", "b");
    mkdirSync(sub, { recursive: true });
    expect(readCortexLink(sub)?.slug).toBe("padre");
    rmSync(dir, { recursive: true, force: true });
  });

  it("opt-out with { ignore: true }", () => {
    const dir = make();
    writeFileSync(join(dir, ".cortex.json"), JSON.stringify({ ignore: true }));
    expect(readCortexLink(dir)).toEqual({ ignore: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("with no .cortex.json → null", () => {
    const dir = make();
    expect(readCortexLink(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("invalid JSON → null (it does not break)", () => {
    const dir = make();
    writeFileSync(join(dir, ".cortex.json"), "{ no json");
    expect(readCortexLink(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
