import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SetupCtx } from "../apps/cli/src/setup/types.js";

/**
 * `cortex doctor` existe para una situación concreta: algo no va y el dev no sabe qué pieza
 * es. Así que lo que hay que comprobar es que **nombra la pieza rota y dice qué hacer**, y
 * que sale con código 1 solo cuando algo impide de verdad que Cortex funcione (que un agente
 * esté sin configurar es un aviso, no un fallo).
 */

let home: string;
let cwd: string;
/**
 * Contexto sin agentes detectados: preguntarle su estado a cada agente significa ejecutar su
 * binario, y eso ni se puede ni se quiere en un test.
 */
const ctxSinAgentes = (): SetupCtx => ({
  home,
  dryRun: true,
  remove: false,
  noPlugin: false,
  log: () => {},
  detect: () => false,
  exec: () => "",
  now: () => new Date("2026-09-10T12:00:00Z"),
});

interface Resultado {
  texto: string;
  hayError: boolean;
}

async function correrDoctor(): Promise<Resultado> {
  const { collectChecks } = await import("../apps/cli/src/commands/doctor.js");
  const checks = await collectChecks(ctxSinAgentes(), cwd);
  return {
    texto: checks.map((c) => `${c.nivel} ${c.nombre} ${c.detalle}${c.arreglo ? ` → ${c.arreglo}` : ""}`).join("\n"),
    hayError: checks.some((c) => c.nivel === "error"),
  };
}

function conCredenciales(server = "http://cortex.test"): void {
  mkdirSync(join(home, ".cortex"), { recursive: true });
  writeFileSync(join(home, ".cortex/credentials"), JSON.stringify({ server, token: "t0ken", email: "dev@example.com" }));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-doctor-home-"));
  cwd = mkdtempSync(join(tmpdir(), "cortex-doctor-cwd-"));
  process.env.CORTEX_HOME = home;
  process.env.INIT_CWD = cwd;
  vi.resetModules();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  delete process.env.CORTEX_HOME;
  delete process.env.INIT_CWD;
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

describe("cortex doctor", () => {
  it("sin sesión, lo dice y manda a iniciarla", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { texto, hayError } = await correrDoctor();
    expect(texto).toContain("not signed in");
    expect(texto).toContain("cortex auth login");
    expect(hayError).toBe(true);
  });

  it("si el servidor no responde, señala el servidor y no el token", async () => {
    conCredenciales();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
    const { texto, hayError } = await correrDoctor();
    expect(texto).toMatch(/Server not responding/);
    expect(texto).not.toContain("Token");
    expect(hayError).toBe(true);
  });

  it("con el token caducado, señala el token", async () => {
    conCredenciales();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/health")) return new Response("{}", { status: 200 });
        return new Response("{}", { status: 401 });
      }),
    );
    const { texto, hayError } = await correrDoctor();
    expect(texto).toMatch(/Token rejected/);
    expect(texto).toContain("cortex auth login");
    expect(hayError).toBe(true);
  });

  it("todo en marcha: 401 del MCP cuenta como vivo, porque está pidiendo auth", async () => {
    conCredenciales();
    writeFileSync(join(cwd, ".cortex.json"), JSON.stringify({ slug: "acme-portal" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.endsWith("/health")) return new Response("{}", { status: 200 });
        if (u.includes("/auth/me")) return new Response(JSON.stringify({ user: { email: "dev@example.com" } }), { status: 200 });
        if (u.includes("/client-config"))
          return new Response(JSON.stringify({ apiUrl: "http://cortex.test", mcpUrl: "http://cortex.test/mcp", webUrl: "http://x", version: "0.1.0", minClientVersion: "0.1.0" }), { status: 200 });
        if (u.endsWith("/mcp")) return new Response("Unauthorized", { status: 401 });
        return new Response("{}", { status: 404 });
      }),
    );
    const { texto, hayError } = await correrDoctor();
    expect(texto).toMatch(/ok MCP/);
    expect(texto).toContain('linked to "acme-portal"');
    expect(hayError).toBe(false);
  });

  it("una carpeta sin vincular es un aviso, con el comando para vincularla", async () => {
    conCredenciales();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { texto } = await correrDoctor();
    expect(texto).toContain("not linked to any project");
    expect(texto).toContain("cortex link");
  });
});
