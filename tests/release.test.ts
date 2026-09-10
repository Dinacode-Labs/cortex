import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as yamlParse } from "yaml";

/**
 * Publicar una versión es de las pocas cosas que no se pueden deshacer: una vez que
 * `@dinacode/cortex@0.2.0` está en npm, ese número ya no se puede reutilizar. Así que lo que
 * se comprueba aquí es que todas las versiones del repo van a la par, y que el workflow no ha
 * perdido el paso que lo verifica antes de publicar nada.
 */
const ROOT = resolve(import.meta.dirname, "..");
const json = (p: string): any => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

describe("versiones del monorepo", () => {
  const root = json("package.json").version as string;

  it("todos los paquetes y apps van a la misma versión", () => {
    const files = execFileSync("sh", ["-c", "ls packages/*/package.json apps/*/package.json"], { cwd: ROOT, encoding: "utf8" })
      .trim()
      .split("\n");
    const distintas = files.map((f) => [f, json(f).version]).filter(([, v]) => v !== root);
    expect(distintas).toEqual([]);
  });

  it("el plugin y su marketplace también, o Claude ofrece actualizar a algo que no existe", () => {
    expect(json("plugin/claude-code/.claude-plugin/plugin.json").version).toBe(root);
    const market = json(".claude-plugin/marketplace.json");
    expect(market.plugins.find((p: { name: string }) => p.name === "cortex").version).toBe(root);
  });

  it("el CHANGELOG tiene una sección para esta versión", () => {
    const notas = execFileSync("node", ["scripts/changelog-notes.mjs", root], { cwd: ROOT, encoding: "utf8" });
    expect(notas.trim().length).toBeGreaterThan(100);
  });
});

describe("workflow de release", () => {
  const wf = yamlParse(readFileSync(resolve(ROOT, ".github/workflows/release.yml"), "utf8")) as {
    on: Record<string, unknown>;
    jobs: Record<string, { needs?: string | string[]; steps?: { name?: string; run?: string; uses?: string }[] }>;
  };

  it("lo dispara un tag de versión, no un push a main", () => {
    expect(JSON.stringify(wf.on)).toContain("v*.*.*");
    expect(JSON.stringify(wf.on)).not.toContain("branches");
  });

  it("nada se publica sin que verify haya pasado antes", () => {
    for (const job of ["image", "npm"]) {
      expect(JSON.stringify(wf.jobs[job]!.needs), job).toContain("verify");
    }
    expect(JSON.stringify(wf.jobs["github-release"]!.needs)).toContain("image");
  });

  it("verify comprueba que el tag coincide con las versiones del repo", () => {
    const pasos = JSON.stringify(wf.jobs.verify!.steps);
    expect(pasos).toContain("GITHUB_REF_NAME");
    expect(pasos).toContain("changelog-notes");
    // Y corre todo lo que corre CI: publicar algo que no pasa los tests no tiene arreglo.
    for (const cmd of ["pnpm typecheck", "pnpm test", "pnpm test:integration", "pnpm build"]) {
      expect(pasos, cmd).toContain(cmd);
    }
  });

  it("las notas de la Release salen del CHANGELOG, no de los commits", () => {
    const pasos = JSON.stringify(wf.jobs["github-release"]!.steps);
    expect(pasos).toContain("changelog-notes.mjs");
    expect(pasos).toContain("body_path");
  });
});
