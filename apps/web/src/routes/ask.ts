import { Hono } from "hono";
import { html } from "hono/html";
import { listAccessibleProjects } from "@cortex/core";
import { askProjectContext } from "@cortex/agents";
import { layout, type Html } from "../views/layout.js";
import { badge } from "../views/components.js";
import { mdLite } from "../views/md.js";
import { requireProject } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Preguntar (agente de recuperación): orquestación compartida con la tool MCP. */
export const askRoutes = new Hono<WebEnv>();

askRoutes.get("/ask", async (c) => {
  const q = c.req.query("q") ?? "";
  const project = c.req.query("project") || undefined;
  const denied = await requireProject(c, project);
  if (denied) return denied;
  const projects = await listAccessibleProjects(c.get("user")?.email ?? null);

  let answerHtml: Html = html``;
  if (q) {
    // Scoping de seguridad (P0): sin proyecto concreto, restringe a accesibles.
    // `undefined` como limit conserva el default (6).
    const { answer, hits } = await askProjectContext(q, project, undefined, {
      restrictToAccessibleOf: c.get("user")?.email ?? null,
    });
    const sources = hits.length
      ? html`<div class="panel"><h2>Sources used</h2>${hits.map(
          (h) => html`<div style="margin-bottom:8px">${badge(h.score.toFixed(2), "#0099ff")} <a href="/entry/${h.entry.id}">${h.entry.title}</a></div>`,
        )}</div>`
      : html`<div class="empty">No relevant context.</div>`;
    answerHtml = answer
      ? html`<div class="answer">${mdLite(answer)}</div>${sources}`
      : html`<div class="warn">⚠️ No LLM configured. Showing search results only.</div>${sources}`;
  }

  const projectOptions = [
    html`<option value="">(all projects)</option>`,
    ...projects.map((p) => html`<option value="${p.name}" ${project === p.name ? "selected" : ""}>${p.name}</option>`),
  ];

  const body = html`
    <p><a class="back" href="/">← Home</a></p>
    <h1>Ask Cortex</h1>
    <p class="sub">The retrieval agent answers from the saved context, and cites what it used.</p>
    <div class="panel">
      <form class="row" method="get" action="/ask">
        <input type="text" name="q" placeholder="e.g. what should I watch out for in the billing module?" value="${q}" required>
        <select name="project">${projectOptions}</select>
        <button type="submit">Ask</button>
      </form>
    </div>
    ${q ? html`<h2 style="font-size:17px">${q}</h2>${answerHtml}` : ""}`;
  return c.html(layout("Ask", body, c.get("user")));
});
