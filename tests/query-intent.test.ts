import { describe, it, expect } from "vitest";
import { inferTypeFromQuery } from "../packages/core/src/query-intent.js";

/**
 * Inferring the type from the question came out of the eval: "what technical debt is there
 * around billing?" retrieved 0 out of 2 because all five results were about billing without any
 * of them being technical debt.
 *
 * What is tested here, above all, is that it does NOT get clever: inferring a type where the
 * question names none would nudge towards the wrong answer in ordinary questions, which are the
 * majority.
 *
 * The questions are in Spanish because the corpus is: these are inputs, not our text.
 */
describe("inferTypeFromQuery", () => {
  it("recognises the category when the question names it", () => {
    expect(inferTypeFromQuery("¿Qué deuda técnica hay alrededor de la facturación?")).toBe("technical_debt");
    expect(inferTypeFromQuery("¿Qué decisiones hay sobre los reintentos?")).toBe("decision");
    expect(inferTypeFromQuery("¿Qué restricciones tiene la subida?")).toBe("constraint");
    expect(inferTypeFromQuery("¿Qué incidencias hemos tenido con el OCR?")).toBe("incident");
    expect(inferTypeFromQuery("¿Qué riesgos hay con el proveedor?")).toBe("risk");
    expect(inferTypeFromQuery("¿Qué convenciones seguimos al migrar?")).toBe("convention");
    expect(inferTypeFromQuery("¿Qué reglas de negocio hay en la facturación?")).toBe("business_rule");
    expect(inferTypeFromQuery("¿Cómo es la arquitectura del servicio?")).toBe("architecture");
  });

  it("in English too, which is what agents sometimes ask in", () => {
    expect(inferTypeFromQuery("what technical debt is around billing?")).toBe("technical_debt");
    expect(inferTypeFromQuery("any constraints on uploads?")).toBe("constraint");
  });

  it("infers nothing from an ordinary question", () => {
    // Half the questions in Spanish start with "cómo": inferring `how_to` here would do harm.
    expect(inferTypeFromQuery("¿Cómo se autentican los usuarios?")).toBeNull();
    expect(inferTypeFromQuery("¿Cuánto pesa como mucho un documento?")).toBeNull();
    expect(inferTypeFromQuery("¿A qué hora se cierra la facturación?")).toBeNull();
    expect(inferTypeFromQuery("¿Dónde se guardan los ficheros?")).toBeNull();
    expect(inferTypeFromQuery("")).toBeNull();
  });

  it("\"technical debt\" beats \"decision\" when both appear", () => {
    // The order of the patterns matters: the specific one first.
    expect(inferTypeFromQuery("¿Qué decisión tomamos sobre la deuda técnica de facturación?")).toBe("technical_debt");
  });
});
