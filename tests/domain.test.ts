import { describe, it, expect } from "vitest";
import { saveContextInput, contextEntryType, confidenceLevel } from "../packages/shared/src/domain";

describe("schemas de dominio (zod)", () => {
  it("saveContextInput exige content y acepta lo mínimo", () => {
    expect(saveContextInput.safeParse({}).success).toBe(false); // content requerido
    const ok = saveContextInput.safeParse({ content: "una decisión técnica" });
    expect(ok.success).toBe(true);
  });

  it("rechaza un type fuera del enum", () => {
    const r = saveContextInput.safeParse({ content: "x", type: "note" });
    expect(r.success).toBe(false); // 'note' no es un contextEntryType válido
  });

  it("acepta un type válido", () => {
    const r = saveContextInput.safeParse({ content: "x", type: "decision" });
    expect(r.success).toBe(true);
  });

  it("enums esperados", () => {
    expect(contextEntryType.options).toContain("decision");
    expect(contextEntryType.options).toContain("incident");
    expect(confidenceLevel.options).toEqual(["low", "medium", "high", "verified"]);
  });
});
