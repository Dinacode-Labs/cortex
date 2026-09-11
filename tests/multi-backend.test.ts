import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Varios Cortex a la vez (ADR-0033). Todo esto existe para evitar UN fallo concreto: que el
 * conocimiento de un cliente acabe en el servidor de otro. Es el peor fallo posible de este
 * producto, porque nadie se entera hasta mucho después, así que aquí se prueba el cableado
 * pieza a pieza en vez de confiar en que salga bien.
 */

let home: string;
let repo: string;

async function client() {
  vi.resetModules();
  return import("../packages/client/src/index.js");
}

function escribirVinculo(dir: string, link: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".cortex.json"), JSON.stringify(link));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-mb-home-"));
  repo = mkdtempSync(join(tmpdir(), "cortex-mb-repo-"));
  process.env.CORTEX_HOME = home;
  delete process.env.CORTEX_SERVER_URL;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CORTEX_HOME;
  vi.unstubAllGlobals();
});

describe("credenciales por servidor", () => {
  it("lee el formato antiguo de una sola sesión sin obligar a volver a entrar", async () => {
    // Quien actualice el CLI tiene un fichero con la forma vieja. Si se ignorase, se
    // quedaría fuera sin explicación.
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(
      join(home, ".cortex/credentials"),
      JSON.stringify({ server: "https://viejo.example.com", token: "t-viejo", email: "yo@example.com" }),
    );
    const { readCredentials, listCredentials } = await client();
    expect(readCredentials()?.token).toBe("t-viejo");
    expect(listCredentials()).toHaveLength(1);
  });

  it("guarda varias sesiones y devuelve la del servidor que se pide", async () => {
    const { writeCredentials, readCredentials } = await client();
    writeCredentials({ server: "https://a.example.com", token: "t-a", email: "yo@a.com" });
    writeCredentials({ server: "https://b.example.com", token: "t-b", email: "yo@b.com" });

    expect(readCredentials("https://a.example.com")?.token).toBe("t-a");
    expect(readCredentials("https://b.example.com")?.token).toBe("t-b");
    // Sin pedir servidor manda la primera, que es la de por defecto.
    expect(readCredentials()?.token).toBe("t-a");
  });

  it("un servidor en el que no has entrado devuelve null, no la sesión de otro", async () => {
    const { writeCredentials, readCredentials } = await client();
    writeCredentials({ server: "https://a.example.com", token: "t-a", email: "yo@a.com" });
    expect(readCredentials("https://otro.example.com")).toBeNull();
  });

  it("la barra final no crea una sesión duplicada", async () => {
    const { writeCredentials, listCredentials, readCredentials } = await client();
    writeCredentials({ server: "https://a.example.com/api", token: "t1", email: "yo@a.com" });
    writeCredentials({ server: "https://a.example.com/api/", token: "t2", email: "yo@a.com" });
    expect(listCredentials()).toHaveLength(1);
    expect(readCredentials("https://a.example.com/api")?.token).toBe("t2");
  });

  it("cerrar sesión en uno no echa de los demás, y el por defecto se reasigna", async () => {
    const { writeCredentials, clearCredentials, listCredentials, defaultServer } = await client();
    writeCredentials({ server: "https://a.example.com", token: "t-a", email: "yo@a.com" });
    writeCredentials({ server: "https://b.example.com", token: "t-b", email: "yo@b.com" });
    expect(defaultServer()).toBe("https://a.example.com");

    clearCredentials("https://a.example.com");
    expect(listCredentials()).toHaveLength(1);
    // Dejar el por defecto apuntando a nada haría fallar cada llamada sin explicar por qué.
    expect(defaultServer()).toBe("https://b.example.com");
  });

  it("el fichero se escribe con permisos 600: lleva tokens", async () => {
    const { writeCredentials, credentialsPath } = await client();
    writeCredentials({ server: "https://a.example.com", token: "t", email: "yo@a.com" });
    const { statSync } = await import("node:fs");
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  });
});

describe("el repo decide el servidor", () => {
  it("un .cortex.json con server apunta ahí, no al de por defecto", async () => {
    const { writeCredentials, useProjectServer, apiBase } = await client();
    writeCredentials({ server: "https://defecto.example.com", token: "t-d", email: "yo@d.com" });
    writeCredentials({ server: "https://cliente.example.com", token: "t-c", email: "yo@c.com" });

    escribirVinculo(repo, { slug: "proyecto-cliente", server: "https://cliente.example.com" });
    useProjectServer(repo);
    expect(apiBase()).toBe("https://cliente.example.com");
  });

  it("un repo sin server vuelve al de por defecto, aunque antes se mirase otro", async () => {
    const { writeCredentials, useProjectServer, apiBase } = await client();
    writeCredentials({ server: "https://defecto.example.com", token: "t-d", email: "yo@d.com" });

    escribirVinculo(repo, { slug: "otro", server: "https://cliente.example.com" });
    useProjectServer(repo);
    const sinServer = mkdtempSync(join(tmpdir(), "cortex-mb-repo2-"));
    escribirVinculo(sinServer, { slug: "normal" });
    useProjectServer(sinServer);
    expect(apiBase()).toBe("https://defecto.example.com");
    rmSync(sinServer, { recursive: true, force: true });
  });

  it("el vínculo se hereda con su servidor desde una subcarpeta", async () => {
    const { writeCredentials, useProjectServer, apiBase } = await client();
    writeCredentials({ server: "https://defecto.example.com", token: "t-d", email: "yo@d.com" });
    escribirVinculo(repo, { slug: "raiz", server: "https://cliente.example.com" });
    const hondo = join(repo, "paquetes", "uno", "src");
    mkdirSync(hondo, { recursive: true });
    useProjectServer(hondo);
    expect(apiBase()).toBe("https://cliente.example.com");
  });
});

describe("el token que se manda es el del servidor al que se llama", () => {
  it("nunca se envía el token de otro servidor", async () => {
    // Es la garantía que sostiene todo lo demás. Con el token equivocado, en el mejor caso
    // es un 401 incomprensible y en el peor una petición a quien no toca.
    const { writeCredentials, useProjectServer, apiRequest } = await client();
    writeCredentials({ server: "https://a.example.com", token: "TOKEN-A", email: "yo@a.com" });
    writeCredentials({ server: "https://b.example.com", token: "TOKEN-B", email: "yo@b.com" });

    const llamadas: { url: string; auth: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        llamadas.push({ url: String(url), auth: String((init.headers as Record<string, string>).authorization ?? "") });
        return new Response("{}", { status: 200 });
      }),
    );

    escribirVinculo(repo, { slug: "p", server: "https://b.example.com" });
    useProjectServer(repo);
    await apiRequest("GET", "/projects");

    expect(llamadas[0]!.url).toBe("https://b.example.com/projects");
    expect(llamadas[0]!.auth).toBe("Bearer TOKEN-B");
  });

  it("sin sesión en ese servidor no se llama a nada y se dice cuál falta", async () => {
    const { writeCredentials, useProjectServer, apiRequest } = await client();
    writeCredentials({ server: "https://a.example.com", token: "TOKEN-A", email: "yo@a.com" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    escribirVinculo(repo, { slug: "p", server: "https://sin-sesion.example.com" });
    useProjectServer(repo);
    const res = await apiRequest("GET", "/projects");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.data)).toContain("sin-sesion.example.com");
  });
});

describe("el MCP se conecta al Cortex del repo", () => {
  it("resuelve el servidor desde el cwd, no desde el de por defecto", async () => {
    // El agente lanza `cortex mcp` desde la carpeta en la que se trabaja. Si el proxy fuera
    // siempre al de por defecto, las tools consultarían la memoria de otro cliente.
    vi.resetModules();
    const { writeCredentials } = await import("../packages/client/src/index.js");
    writeCredentials({ server: "https://defecto.example.com", token: "T-DEF", email: "yo@d.com" });
    writeCredentials({ server: "https://cliente.example.com", token: "T-CLI", email: "yo@c.com" });
    escribirVinculo(repo, { slug: "p", server: "https://cliente.example.com" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).startsWith("https://cliente.example.com")
          ? new Response(JSON.stringify({ mcpUrl: "https://cliente.example.com/mcp" }), { status: 200 })
          : new Response("{}", { status: 404 }),
      ),
    );

    const { resolveUpstream } = await import("../apps/cli/src/mcp/upstream.js");
    const target = await resolveUpstream(repo);
    expect(target?.url).toBe("https://cliente.example.com/mcp");
    expect(target?.token).toBe("T-CLI");
  });
});
