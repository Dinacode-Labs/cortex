import { describe, it, expect } from "vitest";
import { inferTypeFromQuery } from "../packages/core/src/query-intent.js";

/**
 * Deducir el tipo de la pregunta salió del eval: «¿Qué deuda técnica hay alrededor de la
 * facturación?» recuperaba 0 de 2 porque los cinco resultados hablaban de facturación sin que
 * ninguno fuera deuda técnica.
 *
 * Lo que se prueba aquí, sobre todo, es que NO se pase de listo: deducir un tipo donde la
 * pregunta no lo nombra empujaría a la respuesta equivocada en preguntas normales, que son la
 * mayoría.
 */
describe("inferTypeFromQuery", () => {
  it("reconoce la categoría cuando la pregunta la nombra", () => {
    expect(inferTypeFromQuery("¿Qué deuda técnica hay alrededor de la facturación?")).toBe("technical_debt");
    expect(inferTypeFromQuery("¿Qué decisiones hay sobre los reintentos?")).toBe("decision");
    expect(inferTypeFromQuery("¿Qué restricciones tiene la subida?")).toBe("constraint");
    expect(inferTypeFromQuery("¿Qué incidencias hemos tenido con el OCR?")).toBe("incident");
    expect(inferTypeFromQuery("¿Qué riesgos hay con el proveedor?")).toBe("risk");
    expect(inferTypeFromQuery("¿Qué convenciones seguimos al migrar?")).toBe("convention");
    expect(inferTypeFromQuery("¿Qué reglas de negocio hay en la facturación?")).toBe("business_rule");
    expect(inferTypeFromQuery("¿Cómo es la arquitectura del servicio?")).toBe("architecture");
  });

  it("también en inglés, que es en lo que preguntan los agentes a veces", () => {
    expect(inferTypeFromQuery("what technical debt is around billing?")).toBe("technical_debt");
    expect(inferTypeFromQuery("any constraints on uploads?")).toBe("constraint");
  });

  it("no deduce nada en una pregunta normal", () => {
    // Media pregunta en español empieza por "cómo": deducir `how_to` aquí haría daño.
    expect(inferTypeFromQuery("¿Cómo se autentican los usuarios?")).toBeNull();
    expect(inferTypeFromQuery("¿Cuánto pesa como mucho un documento?")).toBeNull();
    expect(inferTypeFromQuery("¿A qué hora se cierra la facturación?")).toBeNull();
    expect(inferTypeFromQuery("¿Dónde se guardan los ficheros?")).toBeNull();
    expect(inferTypeFromQuery("")).toBeNull();
  });

  it("«deuda técnica» gana a «decisión» cuando aparecen las dos", () => {
    // El orden de los patrones importa: lo específico primero.
    expect(inferTypeFromQuery("¿Qué decisión tomamos sobre la deuda técnica de facturación?")).toBe("technical_debt");
  });
});
