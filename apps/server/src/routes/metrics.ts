import { Hono } from "hono";
import { getSql } from "@cortex/database";


/**
 * `GET /metrics` — números en formato de texto de Prometheus.
 *
 * Por qué así y no un panel propio: esto es un producto que despliega otra gente, y cada
 * quien ya tiene su forma de vigilar cosas. Un panel nuestro obligaría a mirarlo; un formato
 * estándar lo lee cualquier stack —Prometheus, Grafana Agent, Datadog, lo que sea— y deja que
 * cada operador ponga SUS umbrales. Es texto plano: no añade ninguna dependencia.
 *
 * Lo que responde a «si hay un problema, ¿cómo me entero?». Hay dos que ningún chequeo de
 * salud ve, porque el servicio sigue respondiendo mientras pasan:
 *
 *   - El **worker** muere. No tiene puerto, así que nada externo lo nota, y es quien mantiene
 *     la memoria (enriquecido, reconciliación, lint). Se degrada despacio y en silencio.
 *   - Las **capturas fallan**. Se quedan en la tabla con `failed` y nadie las mira; el agente
 *     sigue funcionando, así que nadie lo nota hasta que la memoria lleva semanas sin crecer.
 *
 * Apagado por defecto: hace falta `CORTEX_METRICS_TOKEN`. Sin él devuelve 404 y no 403, para
 * no anunciar que existe algo que pedir. Estas cifras dicen cuánto se usa el sistema y cuánto
 * se gasta, que no es información para el mundo.
 */

/** Una métrica en el formato de texto de Prometheus. */
function metrica(nombre: string, ayuda: string, tipo: "gauge" | "counter", valores: { etiquetas?: string; valor: number }[]): string {
  const lineas = [`# HELP ${nombre} ${ayuda}`, `# TYPE ${nombre} ${tipo}`];
  for (const v of valores) lineas.push(`${nombre}${v.etiquetas ? `{${v.etiquetas}}` : ""} ${v.valor}`);
  return lineas.join("\n");
}

export const metricsRoutes = new Hono();

metricsRoutes.get("/metrics", async (c) => {
  const esperado = process.env.CORTEX_METRICS_TOKEN?.trim();
  if (!esperado) return c.notFound();
  if (c.req.header("authorization") !== `Bearer ${esperado}`) return c.notFound();

  const sql = getSql();
  type Fila = Record<string, unknown>;
  const [capturas = [], latidos = [], entradas = [], proyectos = [], uso = []] = (await Promise.all([
    sql`SELECT status, count(*)::int AS n FROM session_captures GROUP BY status`,
    sql`SELECT name, extract(epoch FROM now() - beat_at)::int AS edad FROM worker_heartbeats`,
    sql`SELECT count(*)::int AS n FROM context_entries WHERE valid_to IS NULL`,
    sql`SELECT count(*)::int AS n FROM entities WHERE type = 'project'`,
    sql`SELECT count(*)::int AS llamadas, coalesce(sum(input_tokens),0)::bigint AS entrada,
               coalesce(sum(output_tokens),0)::bigint AS salida FROM llm_usage`,
  ])) as unknown as Fila[][];

  const bloques = [
    metrica("cortex_up", "1 si el servidor responde y la base contesta.", "gauge", [{ valor: 1 }]),
    metrica(
      "cortex_session_captures_total",
      "Sesiones de agente recibidas, por estado. Vigila `failed`: el agente sigue funcionando mientras la memoria deja de crecer.",
      "gauge",
      capturas.map((r) => ({ etiquetas: `status="${r.status}"`, valor: Number(r.n) })),
    ),
    metrica(
      "cortex_worker_heartbeat_age_seconds",
      "Segundos desde el último latido de cada proceso sin puerto. Si crece sin parar, ese proceso ha muerto.",
      "gauge",
      latidos.map((r) => ({ etiquetas: `name="${r.name}"`, valor: Number(r.edad) })),
    ),
    metrica("cortex_entries_total", "Unidades de conocimiento vigentes.", "gauge", [{ valor: Number(entradas[0]?.n ?? 0) }]),
    metrica("cortex_projects_total", "Proyectos.", "gauge", [{ valor: Number(proyectos[0]?.n ?? 0) }]),
    metrica("cortex_llm_calls_total", "Llamadas al proveedor de inferencia registradas.", "counter", [
      { valor: Number(uso[0]?.llamadas ?? 0) },
    ]),
    metrica("cortex_llm_tokens_total", "Tokens del proveedor de inferencia, por dirección.", "counter", [
      { etiquetas: 'direction="input"', valor: Number(uso[0]?.entrada ?? 0) },
      { etiquetas: 'direction="output"', valor: Number(uso[0]?.salida ?? 0) },
    ]),
  ];

  return c.text(`${bloques.join("\n\n")}\n`, 200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
});
