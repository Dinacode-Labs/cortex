import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Una clave mal puesta no puede parecerse a «esta sesión no tenía nada que guardar».
 *
 * Pasó al desplegar el servidor: con la clave equivocada, la captura devolvía
 * `saved: 0, failed: 0` y el estado `done`. Todo verde, cero conocimiento, y así para
 * siempre hasta que alguien se preguntara por qué la memoria seguía vacía.
 */
const runAgent = vi.fn();
vi.mock("../packages/agents/src/mastra.js", () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));

beforeEach(() => {
  runAgent.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function distill() {
  return (await import("../packages/agents/src/distill.js")).distill;
}

describe("distill ante un fallo del proveedor", () => {
  it("lanza si rechaza la clave, para que el fallo llegue arriba", async () => {
    runAgent.mockRejectedValue(Object.assign(new Error("Invalid API key."), { statusCode: 401 }));
    await expect((await distill())("P", "x".repeat(300))).rejects.toThrow(/rechaza la clave/);
  });

  it("también lo detecta cuando solo viene en el texto", async () => {
    runAgent.mockRejectedValue(new Error("AI_APICallError: Unauthorized"));
    await expect((await distill())("P", "x".repeat(300))).rejects.toThrow(/rechaza la clave/);
  });

  it("sin LLM configurado NO es un fallo: es un estado deliberado", async () => {
    // core cae a heurísticas y Cortex sigue siendo útil sin ninguna clave.
    runAgent.mockRejectedValue(new Error("LLM no habilitado (LLM_PROVIDER / API key)."));
    await expect((await distill())("P", "x".repeat(300))).resolves.toEqual([]);
  });

  it("una ventana que devuelve basura se salta, sin tumbar la sesión", async () => {
    // Un modelo que se inventa el formato es recuperable: las demás ventanas pueden ir bien.
    runAgent.mockResolvedValue("esto no es JSON ni de lejos");
    await expect((await distill())("P", "x".repeat(300))).resolves.toEqual([]);
  });

  it("lo normal sigue funcionando", async () => {
    runAgent.mockResolvedValue('{"items":[{"type":"decision","title":"T","content":"C"}]}');
    const items = await (await distill())("P", "x".repeat(300));
    expect(items).toEqual([{ type: "decision", title: "T", content: "C" }]);
  });
});
