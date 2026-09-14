import { describe, it, expect } from "vitest";
import { limitaSesion } from "../packages/client/src/session-capture.js";

/**
 * Una sesión larga de trabajo con un agente pasa del tope del servidor —medido, 154.000
 * caracteres en una sola— y el servidor la rechazaba entera con un 413. Son justo esas las
 * que más conocimiento llevan: perderlas es perder el día.
 */
describe("límite de tamaño de una sesión", () => {
  it("una sesión normal no se toca", () => {
    const s = "[user] ¿qué backoff usamos?\n[assistant] exponencial con tope de 60s";
    expect(limitaSesion(s)).toBe(s);
  });

  it("una demasiado larga se recorta hasta caber", () => {
    const r = limitaSesion("x".repeat(154_035));
    expect(r.length).toBeLessThanOrEqual(150_000);
  });

  it("se recorta por el PRINCIPIO: el final es donde están las conclusiones", () => {
    const inicio = "TANTEO-DEL-PRINCIPIO";
    const fin = "DECISION-DEL-FINAL";
    const r = limitaSesion(inicio + "x".repeat(200) + fin, 120);
    expect(r).toContain(fin);
    expect(r).not.toContain(inicio);
  });

  it("deja una marca, para que la destilación no lea el corte como el comienzo real", () => {
    const r = limitaSesion("x".repeat(1000), 200);
    expect(r.startsWith("[…")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(200);
  });
});
