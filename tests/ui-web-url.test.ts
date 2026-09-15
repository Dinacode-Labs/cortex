import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `cortex ui` se autenticaba contra el servidor correcto y luego abría el navegador en
 * `http://localhost:8080`, porque la dirección de la web era una variable con un default de
 * desarrollo en vez de salir del propio servidor.
 *
 * Es de los fallos más desconcertantes que hay: todo el flujo dice que va bien —sesión,
 * ticket, "Opening the Cortex UI, already signed in"— y la ventana que se abre no existe.
 *
 * El servidor ya publica su `webUrl` en `/client-config`, que está justo para esto.
 */
const src = readFileSync(resolve(import.meta.dirname, "../apps/cli/src/commands/ui.ts"), "utf8");

describe("cortex ui", () => {
  it("saca la dirección de la web de lo que publica el servidor", () => {
    expect(src).toContain("getClientConfig");
    expect(src).toMatch(/cfg\?\.webUrl/);
  });

  it("el default de desarrollo es el ÚLTIMO recurso, no el primero", () => {
    // Orden: lo que pide el entorno > lo que dice el servidor > localhost.
    const linea = src.split("\n").find((l) => l.includes("localhost:8080"));
    expect(linea, "el default debe estar en la misma expresión, al final").toBeDefined();
    expect(linea).toMatch(/CORTEX_WEB_URL.*cfg\?\.webUrl.*localhost:8080/);
  });
});
