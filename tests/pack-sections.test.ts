import { describe, it, expect } from "vitest";
import { PACK_SECTIONS } from "../packages/core/src/context-pack.js";
import { renderContextPack } from "../packages/core/src/render.js";
import { stripLeadingTitle } from "../packages/core/src/text.js";
import { contextEntryType } from "@cortex/shared";
import type { ContextPack } from "../packages/core/src/context-pack.js";
import type { ContextEntry } from "@cortex/shared";

/**
 * ADR-0054: el pack cubre todo el conocimiento que describe el ESTADO del proyecto, no los
 * cinco tipos que alguien escribió a mano en una interfaz.
 */
const entrada = (tipo: string, i: number): ContextEntry =>
  ({
    id: `${tipo}-${i}`,
    title: `${tipo} ${i}`,
    content: "x".repeat(300),
    summary: "y".repeat(180),
    type: tipo,
    status: "active",
    confidence: "medium",
  }) as unknown as ContextEntry;

const pack = (): ContextPack =>
  ({
    project: "Demo",
    totalEntries: 400,
    generatedAt: new Date("2026-09-16T00:00:00Z"),
    sections: PACK_SECTIONS.map((s) => ({
      ...s,
      entries: Array.from({ length: 12 }, (_, i) => entrada(s.type, i)),
    })),
    sensitiveModules: [],
    relevantToArea: [],
    conflicts: [],
  }) as unknown as ContextPack;

describe("qué tipos llegan al agente", () => {
  it("los tipos que describen el estado del proyecto están en el pack", () => {
    const enPack = new Set(PACK_SECTIONS.map((s) => s.type));
    for (const t of ["decision", "constraint", "risk", "technical_debt", "convention",
                     "architecture", "business_rule", "incident", "integration_note",
                     "module_note", "how_to"]) {
      expect(enPack.has(t as never), `"${t}" no llega a ningún agente`).toBe(true);
    }
  });

  it("solo quedan fuera los que son registro de un suceso, y a propósito", () => {
    const fuera = contextEntryType.options.filter((t) => !PACK_SECTIONS.some((s) => s.type === t));
    expect(fuera.sort()).toEqual(["meeting_summary", "pr_summary", "ticket_resolution"]);
  });

  it("con presupuesto llega algo de cada sección, y las que gobiernan el trabajo llevan más", () => {
    const txt = renderContextPack(pack(), { maxChars: 6000 });
    for (const s of PACK_SECTIONS) {
      expect(txt, `falta "${s.titulo}"`).toContain(`## ${s.titulo}`);
      expect(txt, `"${s.titulo}" llegó sin contenido`).toContain(`${s.type} 0`);
    }
    const cuenta = (tipo: string) => (txt.match(new RegExp(`\\*\\*${tipo} \\d+\\*\\*`, "g")) ?? []).length;
    expect(cuenta("decision")).toBeGreaterThan(cuenta("how_to"));
  });

  it("nunca se pasa del tope", () => {
    for (const tope of [1500, 3000, 6000, 12000, 30000]) {
      expect(renderContextPack(pack(), { maxChars: tope }).length, `tope ${tope}`).toBeLessThanOrEqual(tope);
    }
  });
});

describe("el resumen no repite el título", () => {
  it("lo quita cuando el resumen empieza por él", () => {
    const t = "Exportar PDF nativo desde Figma evita el rate-limit";
    const s = `${t} Clic derecho sobre la página en la app de Figma y exportar todos los frames.`;
    expect(stripLeadingTitle(s, t)).toBe("Clic derecho sobre la página en la app de Figma y exportar todos los frames.");
  });

  it("tolera puntuación y mayúsculas, que es como viene de verdad", () => {
    expect(stripLeadingTitle("Cola con 3 reintentos: la cola pasa a tener un tope de tres y una DLQ configurada.", "cola con 3 reintentos"))
      .toBe("la cola pasa a tener un tope de tres y una DLQ configurada.");
  });

  it("si al quitarlo no queda resumen, se deja como estaba", () => {
    const t = "Una decisión sobre la cola";
    expect(stripLeadingTitle(`${t} y poco más.`, t)).toBe(`${t} y poco más.`);
  });

  it("no toca un resumen que no empieza por el título", () => {
    expect(stripLeadingTitle("La cola pasa a tener tope.", "Reintentos")).toBe("La cola pasa a tener tope.");
  });
});
