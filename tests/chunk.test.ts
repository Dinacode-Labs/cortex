import { describe, it, expect } from "vitest";
import { chunkDocument } from "../packages/core/src/chunk";

/**
 * El chunker estructural (ADR-0023, Fase 1) desbloquea la ingesta de documentos largos:
 * antes un doc entraba como 1 entrada/1 vector truncado; ahora se trocea en fragmentos
 * acotados con referencia al padre. Estos tests fijan el contrato: tamaño acotado, doc
 * corto = 1 chunk, solape entre chunks, y robustez ante párrafos gigantes / texto vacío.
 */
describe("chunkDocument", () => {
  it("texto vacío → sin chunks", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("   \n\n  ")).toEqual([]);
  });

  it("documento corto → un único chunk sin solape", () => {
    const r = chunkDocument("# Decisión\n\nSe usa RabbitMQ para exportaciones asíncronas.");
    expect(r).toHaveLength(1);
    expect(r[0].index).toBe(0);
    expect(r[0].total).toBe(1);
    expect(r[0].content).toContain("RabbitMQ");
    expect(r[0].content.startsWith("…")).toBe(false); // el primero nunca lleva solape
    expect(r[0].section).toBe("Decisión");
  });

  it("documento largo → varios chunks, todos dentro del tope", () => {
    const para = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(30); // ~1650 chars
    const doc = Array.from({ length: 12 }, (_, i) => `## Sección ${i}\n\n${para}`).join("\n\n");
    const r = chunkDocument(doc, { targetChars: 2000, maxChars: 2500, overlapChars: 200 });
    expect(r.length).toBeGreaterThan(1);
    for (const c of r) expect(c.content.length).toBeLessThanOrEqual(2500 + 200 + 2); // tope + solape + "…\n\n"
    // índices consecutivos y total coherente
    r.forEach((c, i) => { expect(c.index).toBe(i); expect(c.total).toBe(r.length); });
  });

  it("chunks posteriores llevan solape del anterior", () => {
    const para = "Frase de relleno número uno con suficiente longitud para forzar el corte. ".repeat(20);
    const r = chunkDocument(para, { targetChars: 800, maxChars: 1000, overlapChars: 150 });
    expect(r.length).toBeGreaterThan(1);
    expect(r[1].content.startsWith("…")).toBe(true);
  });

  it("un párrafo gigante sin puntuación se corta duro sin exceder el tope", () => {
    const monster = "x".repeat(12000); // sin espacios ni puntuación
    const r = chunkDocument(monster, { targetChars: 2000, maxChars: 2500, overlapChars: 0 });
    expect(r.length).toBeGreaterThan(1);
    for (const c of r) expect(c.content.length).toBeLessThanOrEqual(2500);
  });

  it("rastrea el heading de Markdown vigente por chunk", () => {
    const big = "Contenido de relleno para llenar la sección. ".repeat(60); // ~2700 chars
    const doc = `# Alfa\n\n${big}\n\n## Beta\n\n${big}`;
    const r = chunkDocument(doc, { targetChars: 2000, maxChars: 2600, overlapChars: 0 });
    expect(r[0].section).toBe("Alfa");
    expect(r.some((c) => c.section === "Beta")).toBe(true);
  });
});
