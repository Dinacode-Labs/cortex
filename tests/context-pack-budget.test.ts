import { describe, it, expect } from "vitest";
import { renderContextPack } from "../packages/core/src/render.js";
import type { ContextPack } from "../packages/core/src/context-pack.js";
import type { ContextEntry } from "@cortex/shared";

/**
 * El hook inyecta el pack al arrancar una sesión y hay un tope de caracteres. Cuando el pack
 * se cortaba con un `slice()` al final, un proyecto con doscientas entradas mandaba al agente
 * sus decisiones y NADA MÁS: restricciones, riesgos y deuda caían fuera de la tijera sin que
 * nadie se enterara. El agente cree que ha visto la memoria del proyecto y ha visto un tercio.
 */
function entrada(tipo: string, i: number): ContextEntry {
  return {
    id: `${tipo}-${i}`,
    title: `${tipo} number ${i}`,
    content: "x".repeat(400),
    summary: "y".repeat(400),
    type: tipo,
    status: "active",
    confidence: "medium",
  } as unknown as ContextEntry;
}

const lista = (tipo: string, n: number) => Array.from({ length: n }, (_, i) => entrada(tipo, i));

const SECCIONES: [string, string, number, number][] = [
  ["decision", "Decisions in force", 2, 20],
  ["constraint", "Active constraints", 2, 8],
  ["risk", "Known risks", 2, 6],
  ["technical_debt", "Technical debt", 2, 5],
  ["convention", "Conventions", 2, 4],
];

const pack = (): ContextPack =>
  ({
    project: "Epic",
    totalEntries: 200,
    generatedAt: new Date("2026-09-15T00:00:00Z"),
    sections: SECCIONES.map(([type, titulo, peso, n]) => ({ type, titulo, peso, entries: lista(type, n) })),
    sensitiveModules: ["payments", "auth"],
    relevantToArea: [],
    conflicts: [],
  }) as unknown as ContextPack;

describe("renderContextPack con presupuesto", () => {
  it("sin tope, el pack sale entero", () => {
    const txt = renderContextPack(pack());
    expect(txt).toContain("decision number 19");
    expect(txt).toContain("constraint number 7");
  });

  it("con tope, TODAS las secciones llegan (antes solo llegaban las decisiones)", () => {
    const txt = renderContextPack(pack(), { maxChars: 6000 });
    for (const t of ["Decisions in force", "Active constraints", "Known risks", "Technical debt", "Conventions"]) {
      expect(txt, `falta la sección "${t}"`).toContain(`## ${t}`);
    }
    // Y de cada una llega contenido de verdad, no solo el título.
    for (const t of ["decision number", "constraint number", "risk number", "technical_debt number", "convention number"]) {
      expect(txt, `la sección de ${t} llegó vacía`).toContain(t);
    }
  });

  it("respeta el tope", () => {
    expect(renderContextPack(pack(), { maxChars: 6000 }).length).toBeLessThanOrEqual(6000);
    expect(renderContextPack(pack(), { maxChars: 2000 }).length).toBeLessThanOrEqual(2000);
  });

  it("dice cuánto se ha dejado fuera en vez de callárselo", () => {
    expect(renderContextPack(pack(), { maxChars: 6000 })).toMatch(/…and \d+ more here/);
  });

  it("nunca se pasa del tope, lo pidas como lo pidas", () => {
    for (const tope of [500, 1000, 2000, 3000, 6000, 12000, 20000, 40000]) {
      expect(renderContextPack(pack(), { maxChars: tope }).length, `tope ${tope}`).toBeLessThanOrEqual(tope);
    }
  });

  it("lo que una sección no gasta se reparte: una pequeña no se lleva hueco de más", () => {
    const p = pack();
    (p as { sensitiveModules: string[] }).sensitiveModules = ["payments"]; // una sección diminuta
    const txt = renderContextPack(p, { maxChars: 6000 });
    expect(txt).toContain("- payments");
    expect(txt).not.toMatch(/## Sensitive modules[\s\S]*…and/); // no recorta una lista que cabía
  });
});
