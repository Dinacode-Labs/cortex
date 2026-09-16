import { describe, it, expect } from "vitest";
import { entityType, isUsableEntityName } from "@cortex/shared";

/**
 * Una entidad es una COSA QUE SE NOMBRA, no una afirmación sobre el proyecto.
 *
 * Cuando `entityType` admitía `decision` e `incident` —que son tipos de entrada— el extractor
 * creaba nodos cuyo nombre era la frase entera, duplicando en el grafo lo que ya estaba en la
 * memoria. En una instalación real: 222 nodos así, y las 18 contradicciones detectadas eran
 * todas entre nombres de nodo, ninguna entre entradas. Ver ADR-0055.
 */
describe("qué puede ser una entidad", () => {
  it("los tipos de entrada no son tipos de entidad", () => {
    for (const t of ["decision", "incident"]) {
      expect(entityType.options as readonly string[], `"${t}" duplicaría entradas en el grafo`).not.toContain(t);
    }
  });

  it("los nombres de verdad pasan", () => {
    for (const n of ["OkHttpClient", "src/cola.ts", "Stripe", "módulo de pagos", "GitLab CI"]) {
      expect(isUsableEntityName(n), n).toBe(true);
    }
  });

  it("las frases no", () => {
    for (const n of [
      "No asumir rutas del origen en el destino",
      "Publicar Cortex en abierto y monetizar la implementación",
      "Comunicación no agresiva hacia el cliente.",
    ]) {
      expect(isUsableEntityName(n), n).toBe(false);
    }
  });

  it("los deícticos tampoco: no nombran nada por sí solos", () => {
    for (const n of ["opción C", "opción A", "la opción b", "v3", "caso 2", "fase 1"]) {
      expect(isUsableEntityName(n), n).toBe(false);
    }
  });

  it("ni lo demasiado corto o sin letras", () => {
    for (const n of ["ab", "  ", "42", "—"]) expect(isUsableEntityName(n), JSON.stringify(n)).toBe(false);
  });
});
