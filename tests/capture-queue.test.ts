import { describe, it, expect } from "vitest";
import { createCaptureQueue } from "../apps/server/src/capture-queue";

/**
 * The queue caps how many distillations run at once because the inference provider limits
 * requests per key: without it, ten devs closing a session at the same time produce a burst
 * of 429s.
 *
 * What has to be guaranteed: the limit is never exceeded, a failing job does not jam the
 * queue, and `enqueue`'s promise resolves when THAT job finishes (the `?wait=1` mode depends
 * on it).
 */
describe("createCaptureQueue", () => {
  it("does not exceed the configured concurrency", async () => {
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

  it("serialises at concurrency 1 and respects arrival order", async () => {
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

  it("a failing job neither jams the queue nor brings the process down", async () => {
    const hechos: number[] = [];
    const queue = createCaptureQueue<number>({
      concurrency: 1,
      run: async (n) => {
        if (n === 2) throw new Error("distillation failed");
        hechos.push(n);
      },
    });
    // `enqueue` does not reject: the failure is recorded in the database, not propagated.
    await Promise.all([queue.enqueue(1), queue.enqueue(2), queue.enqueue(3)]);
    expect(hechos).toEqual([1, 3]);
    expect(queue.inFlight()).toBe(0);
  });

  it("enqueue's promise resolves when THAT job finishes (the basis of ?wait=1)", async () => {
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
