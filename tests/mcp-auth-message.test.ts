import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SinSesionError } from "../apps/cli/src/mcp/upstream.js";

/**
 * «No has iniciado sesión» era mentira la mayoría de las veces.
 *
 * El caso real es otro: la carpeta apunta —por su `.cortex.json` o por `CORTEX_SERVER_URL`— a
 * un servidor del que no hay credenciales, mientras sí las hay de otro. El mensaje mandaba a
 * repetir un `cortex auth login` ya hecho, y quien lo leía se quedaba dando vueltas. Un error
 * que dirige mal cuesta más que uno que calla, porque parece que sabe.
 */
const casas: string[] = [];

function conSesiones(servidores: [string, string][]): string {
  const home = mkdtempSync(join(tmpdir(), "cortex-home-"));
  casas.push(home);
  mkdirSync(join(home, ".cortex"));
  writeFileSync(
    join(home, ".cortex", "credentials"),
    JSON.stringify({
      version: 2,
      default: servidores[0]?.[0],
      servers: Object.fromEntries(servidores.map(([s, email]) => [s, { token: "t", email }])),
    }),
  );
  process.env.CORTEX_HOME = home;
  return home;
}

afterEach(() => {
  delete process.env.CORTEX_HOME;
  for (const c of casas.splice(0)) rmSync(c, { recursive: true, force: true });
});

describe("cuando el MCP no puede autenticarse", () => {
  it("dice QUÉ servidor buscó, no un genérico", () => {
    conSesiones([["https://cortex.example.com/api", "yo@example.com"]]);
    const e = new SinSesionError("http://localhost:8787", "/repos/mi-proyecto");
    expect(e.message).toContain("http://localhost:8787");
    expect(e.message).toContain("/repos/mi-proyecto");
  });

  it("y enseña las sesiones que SÍ hay, que es lo que resuelve el lío", () => {
    conSesiones([["https://cortex.example.com/api", "yo@example.com"]]);
    const e = new SinSesionError("https://cortex.example.com", "/repos/mi-proyecto");
    expect(e.message).toContain("https://cortex.example.com/api");
    expect(e.message).toContain("yo@example.com");
    // Con otra sesión disponible, lo primero que sugiere es mirar a dónde apunta la carpeta,
    // no repetir el login que ya se hizo.
    expect(e.message).toMatch(/\.cortex\.json|CORTEX_SERVER_URL/);
  });

  it("si de verdad no hay ninguna sesión, dice eso y manda a iniciarla", () => {
    conSesiones([]);
    const e = new SinSesionError("https://cortex.example.com/api", "/repos/x");
    expect(e.message).toContain("no sessions on this machine");
    expect(e.message).toContain("cortex auth login --server https://cortex.example.com/api");
  });
});
