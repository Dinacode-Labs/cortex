import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * `@cortex/client` existe para poder empaquetar el CLI y distribuirlo con `npm i -g`
 * (ADR-0025). Eso solo se sostiene si el paquete NO arrastra Postgres, Mastra ni la capa
 * de embeddings: son ~95 MB que no pintan nada en el portátil de un dev.
 *
 * Es una regla fácil de romper sin darse cuenta (un import "que ya está ahí"), así que se
 * comprueba en el test en vez de confiar en la revisión.
 */
const PROHIBIDAS = ["@cortex/database", "@cortex/core", "@cortex/agents", "@cortex/embeddings"];

function ficherosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? ficherosTs(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

describe("@cortex/client se mantiene ligero", () => {
  it("solo declara @cortex/shared como dependencia interna", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "packages/client/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const internas = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@cortex/"));
    expect(internas).toEqual(["@cortex/shared"]);
  });

  it("ningún fichero importa los paquetes pesados", () => {
    const ofensores: string[] = [];
    for (const f of ficherosTs(join(ROOT, "packages/client/src"))) {
      const src = readFileSync(f, "utf8");
      for (const dep of PROHIBIDAS) {
        if (src.includes(`from "${dep}"`)) ofensores.push(`${f.replace(ROOT, "")} → ${dep}`);
      }
    }
    expect(ofensores).toEqual([]);
  });
});

describe("el CLI `cortex` se mantiene instalable", () => {
  it("no depende de los paquetes pesados: van en cortex-admin", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // Los dos paquetes internos se bundlean, así que están declarados como devDependencies:
    // si estuvieran en `dependencies`, npm intentaría descargarlos al instalar el CLI.
    const todas = { ...pkg.dependencies, ...pkg.devDependencies };
    const internas = Object.keys(todas).filter((d) => d.startsWith("@cortex/"));
    expect(internas.sort()).toEqual(["@cortex/client", "@cortex/shared"]);
    expect(Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@cortex/"))).toEqual([]);
  });

  it("ningún comando del CLI importa Postgres, core, agents ni embeddings", () => {
    const ofensores: string[] = [];
    for (const f of ficherosTs(join(ROOT, "apps/cli/src"))) {
      const src = readFileSync(f, "utf8");
      for (const dep of PROHIBIDAS) {
        if (src.includes(`from "${dep}"`)) ofensores.push(`${f.replace(ROOT, "")} → ${dep}`);
      }
    }
    expect(ofensores).toEqual([]);
  });
});

describe("cliente tipado de la API", () => {
  beforeEach(() => {
    vi.stubEnv("CORTEX_SERVER_URL", "https://cortex.example.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("getClientConfig no lanza si el servidor no responde: devuelve null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { getClientConfig } = await import("@cortex/client");
    await expect(getClientConfig()).resolves.toBeNull();
  });

  it("getClientConfig devuelve null en un servidor antiguo (404), sin romper", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    const { getClientConfig } = await import("@cortex/client");
    await expect(getClientConfig()).resolves.toBeNull();
  });

  it("un endpoint autenticado sin credenciales devuelve 401 en vez de lanzar", async () => {
    // Sin `~/.cortex/credentials` (HOME apuntando a un sitio sin nada) no hay token.
    vi.stubEnv("HOME", "/tmp/cortex-sin-credenciales-" + Date.now());
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { listProjects } = await import("@cortex/client");
    const res = await listProjects();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled(); // ni se molesta en salir a la red
  });
});
