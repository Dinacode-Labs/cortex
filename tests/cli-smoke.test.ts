import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLI_VERSION, isOlderThan } from "../apps/cli/src/version.js";

/**
 * El CLI se publica en npm, así que dos cosas tienen que cuadrar antes de eso: que todos los
 * comandos que anuncia el `--help` existan de verdad (un `import()` roto solo se ve al
 * ejecutarlo), y que el paquete declare como dependencias justo lo que el bundle NO lleva
 * dentro. Publicar un `@cortex/client` como dependencia haría que npm intentara descargarlo.
 */

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../apps/cli/package.json"), "utf8")) as {
  name: string;
  version: string;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files: string[];
};

describe("paquete @dinacodelabs/cortex", () => {
  it("se publica con un solo binario y solo lo que hace falta", () => {
    expect(pkg.name).toBe("@dinacodelabs/cortex");
    expect(pkg.bin).toEqual({ cortex: "./dist/cortex.js" });
    expect(pkg.files).toContain("dist");
  });

  it("no declara los paquetes del monorepo como dependencias: van dentro del bundle", () => {
    for (const dep of Object.keys(pkg.dependencies)) {
      expect(dep.startsWith("@cortex/"), `${dep} no se puede descargar de npm`).toBe(false);
    }
    // Y sí están como devDependencies, o el bundler no los encontraría.
    expect(Object.keys(pkg.devDependencies)).toContain("@cortex/client");
  });

  it("deja fuera del bundle lo que un bundle plano rompería", () => {
    // El SDK de MCP hace require dinámicos; zod y yaml son públicos y no cuesta nada bajarlos.
    for (const dep of ["@modelcontextprotocol/sdk", "zod", "yaml"]) expect(pkg.dependencies).toHaveProperty(dep);
  });
});

describe("comandos anunciados", () => {
  it("todos los que salen en la ayuda se pueden cargar y tienen `run`", async () => {
    const src = readFileSync(resolve(import.meta.dirname, "../apps/cli/src/index.ts"), "utf8");
    const rutas = [...src.matchAll(/import\("(\.\/commands\/[a-z-]+\.js)"\)/g)].map((m) => m[1]!);
    expect(rutas.length).toBeGreaterThan(8);
    for (const ruta of rutas) {
      const mod = (await import(resolve(import.meta.dirname, "../apps/cli/src", ruta.replace("./", "").replace(/\.js$/, ".ts")))) as {
        run?: unknown;
      };
      expect(typeof mod.run, ruta).toBe("function");
    }
  });
});

describe("versión del CLI", () => {
  it("en desarrollo dice `dev`, y `dev` nunca se considera antigua", () => {
    // Con tsx no hay bundle, así que la constante inyectada no existe.
    expect(CLI_VERSION).toBe("dev");
    expect(isOlderThan("dev", "9.9.9")).toBe(false);
  });

  it("compara versiones sin sorpresas", () => {
    expect(isOlderThan("0.1.0", "0.2.0")).toBe(true);
    expect(isOlderThan("0.9.0", "0.10.0")).toBe(true); // no es orden alfabético
    expect(isOlderThan("1.0.0", "0.9.9")).toBe(false);
    expect(isOlderThan("0.1.0", "0.1.0")).toBe(false);
  });
});
