import { Hono } from "hono";
import { getSql } from "@cortex/database";


/**
 * Why this rather than a dashboard of our own: this is a product other people deploy, and each
 * of them already has their own way of watching things. Our dashboard would force them to look
 * at it; a standard format is read by any stack -- Prometheus, Grafana Agent, Datadog, whatever
 * -- and lets each operator set THEIR thresholds. It is plain text: it adds no dependency.
 *
 * This is the answer to "if something goes wrong, how do I find out?". Two things no health
 * check sees, because the service keeps answering while they happen:
 *
 *   - The **worker** dies. It has no port, so nothing external notices, and it is what
 *     maintains the memory (enrichment, reconciliation, lint). It degrades slowly and silently.
 *   - **Captures fail**. They sit in the table as `failed` and nobody looks; the agent keeps
 *     working, so nobody notices until the memory has not grown for weeks.
 *
 * Off by default: `CORTEX_METRICS_TOKEN` is required. Without it the answer is 404 and not 403,
 * so as not to advertise that there is something to ask for. These numbers say how much the
 * system is used and how much it costs, which is not information for the world.
 */

function metric(name: string, help: string, type: "gauge" | "counter", values: { labels?: string; value: number }[]): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const v of values) lines.push(`${name}${v.labels ? `{${v.labels}}` : ""} ${v.value}`);
  return lines.join("\n");
}

export const metricsRoutes = new Hono();

metricsRoutes.get("/metrics", async (c) => {
  const expected = process.env.CORTEX_METRICS_TOKEN?.trim();
  if (!expected) return c.notFound();
  if (c.req.header("authorization") !== `Bearer ${expected}`) return c.notFound();

  const sql = getSql();
  type Row = Record<string, unknown>;
  const [captures = [], heartbeats = [], entries = [], projects = [], usage = []] = (await Promise.all([
    sql`SELECT status, count(*)::int AS n FROM session_captures GROUP BY status`,
    sql`SELECT name, extract(epoch FROM now() - beat_at)::int AS age FROM worker_heartbeats`,
    sql`SELECT count(*)::int AS n FROM context_entries WHERE valid_to IS NULL`,
    sql`SELECT count(*)::int AS n FROM entities WHERE type = 'project'`,
    sql`SELECT count(*)::int AS calls, coalesce(sum(input_tokens),0)::bigint AS input,
               coalesce(sum(output_tokens),0)::bigint AS output FROM llm_usage`,
  ])) as unknown as Row[][];

  const blocks = [
    metric("cortex_up", "1 when the server answers and the database replies.", "gauge", [{ value: 1 }]),
    metric(
      "cortex_session_captures_total",
      "Agent sessions received, by status. Watch `failed`: the agent keeps working while the memory stops growing.",
      "gauge",
      captures.map((r) => ({ labels: `status="${r.status}"`, value: Number(r.n) })),
    ),
    metric(
      "cortex_worker_heartbeat_age_seconds",
      "Seconds since each portless process last beat. If it grows without stopping, that process has died.",
      "gauge",
      heartbeats.map((r) => ({ labels: `name="${r.name}"`, value: Number(r.age) })),
    ),
    metric("cortex_entries_total", "Current knowledge units.", "gauge", [{ value: Number(entries[0]?.n ?? 0) }]),
    metric("cortex_projects_total", "Projects.", "gauge", [{ value: Number(projects[0]?.n ?? 0) }]),
    metric("cortex_llm_calls_total", "Recorded calls to the inference provider.", "counter", [
      { value: Number(usage[0]?.calls ?? 0) },
    ]),
    metric("cortex_llm_tokens_total", "Inference provider tokens, by direction.", "counter", [
      { labels: 'direction="input"', value: Number(usage[0]?.input ?? 0) },
      { labels: 'direction="output"', value: Number(usage[0]?.output ?? 0) },
    ]),
  ];

  return c.text(`${blocks.join("\n\n")}\n`, 200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
});
