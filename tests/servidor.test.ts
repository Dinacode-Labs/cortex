import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Qué Cortex usa un comando que NO trabaja dentro de un repositorio.
 *
 * Los que sí —hooks, `mem`, el proxy MCP, los conectores— lo sacan del `.cortex.json` y no
 * preguntan nunca (ADR-0033): la carpeta siempre sabe, y la persona puede no acordarse.
 *
 * `auth login` adivinaba, y adivinaba mal: se iba al servidor de desarrollo por defecto
 * ignorando el que ya estaba configurado, así que con dos sesiones acababas autenticándote
 * contra el que no era sin enterarte.
 */
let home: string;

function conSesiones(...servidores: string[]): void {
  mkdirSync(join(home, ".cortex"), { recursive: true });
  const servers = Object.fromEntries(servidores.map((s) => [s, { token: "t", email: "dev@example.com" }]));
  writeFileSync(join(home, ".cortex/credentials"), JSON.stringify({ version: 2, servers, default: servidores[0] }));
}

async function resolver(args: string[] = []): Promise<string | null> {
  const { resolveServidor } = await import("../apps/cli/src/servidor.js");
  return resolveServidor(args, { verbo: "sign in to", permitirDesconocido: true });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-servidor-"));
  process.env.CORTEX_HOME = home;
  delete process.env.CORTEX_SERVER_URL;
  vi.resetModules();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.CORTEX_HOME;
  vi.unstubAllEnvs();
});

describe("elegir servidor cuando la carpeta no manda", () => {
  it("lo que se pide a mano gana a todo", async () => {
    conSesiones("https://uno.test", "https://dos.test");
    expect(await resolver(["--server", "https://tres.test"])).toBe("https://tres.test");
  });

  it("el entorno gana a lo guardado: es como un script dice cuál", async () => {
    conSesiones("https://uno.test", "https://dos.test");
    vi.stubEnv("CORTEX_SERVER_URL", "https://del-entorno.test");
    expect(await resolver()).toBe("https://del-entorno.test");
  });

  it("con una sola sesión, esa; NO el de desarrollo por defecto", async () => {
    conSesiones("https://el-unico.test");
    expect(await resolver()).toBe("https://el-unico.test");
  });

  it("con varias y sin nadie delante, no adivina", async () => {
    conSesiones("https://uno.test", "https://dos.test");
    const errores: string[] = [];
    const orig = console.error;
    console.error = ((...a: unknown[]) => errores.push(a.join(" "))) as typeof console.error;
    try {
      expect(await resolver()).toBeNull();
    } finally {
      console.error = orig;
    }
    // Y dice cómo salir del paso, con las dos opciones.
    expect(errores.join("\n")).toContain("--server https://uno.test");
    expect(errores.join("\n")).toContain("--server https://dos.test");
  });

  it("sin ninguna sesión, el de por defecto (es el primer login de alguien)", async () => {
    expect(await resolver()).toBe("http://localhost:8787");
  });
});
