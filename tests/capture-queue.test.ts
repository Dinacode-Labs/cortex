import { describe, it, expect } from "vitest";
import { createCaptureQueue } from "../apps/server/src/capture-queue";

/**
 * La cola limita cuántas destilaciones corren a la vez porque el proveedor de inferencia
 * acota peticiones por clave: sin ella, diez devs cerrando sesión al mismo tiempo producen
 * una ráfaga de 429.
 *
 * Lo que hay que garantizar: que no se supera el límite, que un trabajo que falla no
 * atasca la cola, y que la promesa de `enqueue` resuelve cuando termina ESE trabajo (de eso
 * depende el modo `?wait=1`).
 */
describe("createCaptureQueue", () => {
  it("no supera la concurrencia configurada", async () => {
    let activos = 0;
    let pico = 0;
    const queue = createCaptureQueue<number>({
      concurrency: 2,
      run: async () => {
        activos++;
        pico = Math.max(pico, activos);
        await new Promise((r) => setTimeout(r, 5));
        activos--;
      },
    });
    await Promise.all(Array.from({ length: 10 }, (_, i) => queue.enqueue(i)));
    expect(pico).toBe(2);
    expect(queue.size()).toBe(0);
    expect(queue.inFlight()).toBe(0);
  });

  it("serializa con concurrencia 1 y respeta el orden de llegada", async () => {
    const orden: number[] = [];
    const queue = createCaptureQueue<number>({
      concurrency: 1,
      run: async (n) => {
        await new Promise((r) => setTimeout(r, 3));
        orden.push(n);
      },
    });
    await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]);
    expect(orden).toEqual([1, 2, 3]);
  });

  it("un trabajo que falla no atasca la cola ni tumba el proceso", async () => {
    const hechos: number[] = [];
    const queue = createCaptureQueue<number>({
      concurrency: 1,
      run: async (n) => {
        if (n === 2) throw new Error("destilación fallida");
        hechos.push(n);
      },
    });
    // `enqueue` no rechaza: el fallo se registra en la BD, no se propaga al llamador.
    await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]);
    expect(hechos).toEqual([1, 3]);
    expect(queue.inFlight()).toBe(0);
  });

  it("la promesa de enqueue resuelve al terminar ESE trabajo (base del ?wait=1)", async () => {
    let terminado = false;
    const queue = createCaptureQueue<string>({
      concurrency: 1,
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        terminado = true;
      },
    });
    await queue.enqueue("x");
    expect(terminado).toBe(true);
  });
});
