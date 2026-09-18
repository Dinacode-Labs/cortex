import { describe, it, expect } from "vitest";
import { saveContextInput, contextEntryType, confidenceLevel } from "../packages/shared/src/domain";

describe("schemas de dominio (zod)", () => {
  it("saveContextInput requires content and accepts the bare minimum", () => {
    expect(saveContextInput.safeParse({}).success).toBe(false); // content requerido
    const ok = saveContextInput.safeParse({ content: "a technical decision" });
    expect(ok.success).toBe(true);
  });

  it("rejects a type outside the enum", () => {
    const r = saveContextInput.safeParse({ content: "x", type: "note" });
    expect(r.success).toBe(false); // 'note' is not a valid contextEntryType
  });

  it("accepts a valid type", () => {
    const r = saveContextInput.safeParse({ content: "x", type: "decision" });
    expect(r.success).toBe(true);
  });

  it("enums esperados", () => {
    expect(contextEntryType.options).toContain("decision");
    expect(contextEntryType.options).toContain("incident");
    expect(confidenceLevel.options).toEqual(["low", "medium", "high", "verified"]);
  });
});
