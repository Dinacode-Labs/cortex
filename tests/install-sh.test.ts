import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `install.sh` lo ejecuta gente con `curl … | sh`, que es la forma más directa que hay de
 * romperle el equipo a alguien. No hay forma de testear la instalación de verdad en CI, así
 * que lo que se comprueba es lo que se puede: que el script es válido para `sh` (no bash), que
 * el servidor puede inyectar su URL, y que no ha vuelto ninguna de las cosas que quitamos.
 */
const SCRIPT = resolve(import.meta.dirname, "../scripts/install.sh");
const src = readFileSync(SCRIPT, "utf8");

describe("scripts/install.sh", () => {
  it("es sintaxis POSIX válida y ejecutable", () => {
    execFileSync("sh", ["-n", SCRIPT]);
    expect(statSync(SCRIPT).mode & 0o111).toBeGreaterThan(0);
  });

  it("lleva el hueco donde el servidor inyecta su URL", () => {
    // apps/server/src/routes/install.ts hace el reemplazo al servirlo.
    expect(src).toContain("__CORTEX_SERVER_URL__");
    expect(src.split("__CORTEX_SERVER_URL__").length - 1).toBeGreaterThanOrEqual(1);
  });

  it("instala desde npm y no clona el repo", () => {
    expect(src).toContain("npm install -g");
    expect(src).not.toContain("git clone");
    expect(src).not.toContain("pnpm install");
    expect(src).not.toContain(".dinacode-cortex");
  });

  it("exige Node ≥ 20 pero no lo instala por su cuenta", () => {
    expect(src).toContain('"$MAJOR" -ge 20');
    // Instalarle a alguien una versión de Node por detrás le rompe otros proyectos: esos
    // comandos solo pueden aparecer como sugerencia impresa, nunca como línea que se ejecuta.
    const ejecuta = src.split("\n").filter((l) => /^\s*(brew|nvm|fnm|corepack)\s/.test(l));
    expect(ejecuta).toEqual([]);
  });

  it("configura los agentes con `cortex setup`, no con el comando retirado", () => {
    expect(src).toContain("cortex setup --all");
    expect(src).not.toContain("cortex sync");
  });

  it("lee el código de la terminal, no de stdin (curl | sh se lo ha quedado)", () => {
    expect(src).toContain("/dev/tty");
    expect(src).toContain("cortex auth login --server");
  });

  /**
   * El instalador silenciaba la salida de npm y culpaba siempre a los permisos. Un paquete
   * que no existe, un registro caído o un proxy por medio mandaban a la gente a reconfigurar
   * su npm para nada, que es la peor primera impresión posible.
   */
  it("distingue por qué ha fallado npm en vez de culpar siempre a los permisos", () => {
    const sh = src;
    expect(sh).toMatch(/E404|404 Not Found/);
    expect(sh).toMatch(/EACCES|EPERM/);
    expect(sh).toMatch(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/);
    // Y si no es ninguna de las tres, enseña lo que dijo npm en vez de inventarse una causa.
    expect(sh).toContain("Esto es lo que ha dicho npm");
    // La salida ya no se tira: sin guardarla no hay nada que mirar.
    expect(sh).not.toMatch(/npm install -g "\$PKG" >\/dev\/null/);
  });
});
