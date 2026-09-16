import { describe, it, expect } from "vitest";
import { trocea, windows } from "../packages/client/src/transcript-utils.js";

/**
 * Una sesión que no cabe entera en el destilado perdía siempre el final.
 *
 * El troceado cortaba al llegar al tope de ventanas, así que de una sesión de 128.000
 * caracteres se destilaban los primeros 72.000 y se tiraba el resto — y en una sesión de
 * trabajo las conclusiones están al final. Además la captura terminaba en `done` con sus
 * contadores, idéntica a una que sí había cabido: nada decía que faltara la mitad.
 */
const sesion = (turnos: number, porTurno = 1000) =>
  Array.from({ length: turnos }, (_, i) => `TURNO-${i} ` + "x".repeat(porTurno)).join("\n\n");

describe("troceado de una sesión", () => {
  it("una sesión que cabe entera no pierde nada", () => {
    const { ventanas, descartados } = trocea(sesion(10));
    expect(descartados).toBe(0);
    expect(ventanas.join("\n\n")).toContain("TURNO-9");
  });

  it("cuando no cabe, el FINAL sigue llegando", () => {
    const t = sesion(200); // ~200.000 caracteres: muy por encima del tope
    const { ventanas, descartados } = trocea(t);
    expect(descartados).toBeGreaterThan(0);
    const texto = ventanas.join("\n\n");
    expect(texto, "el arranque debe estar").toContain("TURNO-0");
    expect(texto, "el cierre es donde están las conclusiones").toContain("TURNO-199");
  });

  it("y lo de en medio también, repartido, no solo los extremos", () => {
    const { ventanas } = trocea(sesion(200));
    const indices = ventanas
      .map((v) => Number(v.match(/TURNO-(\d+)/)![1]))
      .sort((a, b) => a - b);
    expect(indices.length).toBeGreaterThan(2);
    // Ni todo al principio ni todo al final: el recorrido queda cubierto.
    expect(indices[Math.floor(indices.length / 2)]).toBeGreaterThan(50);
    expect(indices[Math.floor(indices.length / 2)]).toBeLessThan(150);
  });

  it("dice cuánto se ha dejado fuera, en vez de callárselo", () => {
    const t = sesion(200);
    const { ventanas, descartados } = trocea(t);
    const usado = ventanas.reduce((n, v) => n + v.length, 0);
    // Lo descartado más lo usado da la sesión entera (± los separadores entre ventanas).
    expect(descartados + usado).toBeGreaterThan(t.length * 0.95);
  });

  it("`windows` sigue devolviendo lo de siempre para quien solo quiere el texto", () => {
    expect(windows(sesion(5))).toEqual(trocea(sesion(5)).ventanas);
  });
});
