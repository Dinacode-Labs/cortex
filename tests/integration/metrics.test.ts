import { describe, it, expect, afterAll, vi } from "vitest";
import { closeSql } from "@cortex/database";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

/**
 * Los chequeos de salud dicen si el servicio responde, y eso deja fuera los dos problemas que
 * de verdad duelen aquí: que el worker muera —no tiene puerto, y es quien mantiene la memoria
 * viva— y que las capturas empiecen a fallar mientras todo lo demás parece bien.
 *
 * Se expone en el formato de texto de Prometheus a propósito: esto lo despliega otra gente,
 * que ya tiene su forma de vigilar. Un panel propio obliga a mirarlo; un formato estándar lo
 * lee su stack y deja que pongan sus umbrales.
 */
afterAll(async () => {
  await closeSql();
});

describe("GET /metrics", () => {
  it("apagado por defecto, y responde 404 en vez de 403", async () => {
    // 403 anunciaría que hay algo que pedir. 404 no dice nada.
    const res = await createServerApp().request("/metrics");
    expect(res.status).toBe(404);
  });

  it("con token configurado, sin él o con uno que no es, sigue siendo 404", async () => {
    vi.stubEnv("CORTEX_METRICS_TOKEN", "s3cr3t");
    try {
      const app = createServerApp();
      expect((await app.request("/metrics")).status).toBe(404);
      expect((await app.request("/metrics", { headers: { authorization: "Bearer otro" } })).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("con el token correcto, devuelve métricas que un Prometheus puede leer", async () => {
    vi.stubEnv("CORTEX_METRICS_TOKEN", "s3cr3t");
    try {
      const res = await createServerApp().request("/metrics", { headers: { authorization: "Bearer s3cr3t" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");

      const texto = await res.text();
      // Formato: cada métrica con su HELP y su TYPE, que es lo que la hace legible.
      for (const m of ["cortex_up", "cortex_session_captures_total", "cortex_worker_heartbeat_age_seconds", "cortex_entries_total", "cortex_llm_tokens_total"]) {
        expect(texto, m).toContain(`# HELP ${m}`);
        expect(texto, m).toContain(`# TYPE ${m}`);
      }
      expect(texto).toMatch(/^cortex_up 1$/m);
      expect(texto).toMatch(/^cortex_llm_tokens_total\{direction="input"\} \d+$/m);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
