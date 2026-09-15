import { Hono } from "hono";
import { findProjectByName } from "@cortex/core";
import type { WebEnv } from "../middleware/session.js";

/**
 * Las direcciones viejas siguen funcionando (ADR-0050).
 *
 * Las URL de la UI están en marcadores, en pestañas abiertas y en enlaces que alguien pegó en
 * un chat hace semanas. Cambiar la estructura y dejar 404 detrás convierte una mejora en una
 * molestia para justo la gente que más la usaba, así que cada ruta antigua lleva a su sitio
 * nuevo. Se van cuando dejen de recibir visitas, no antes.
 */
export const redirectRoutes = new Hono<WebEnv>();

/** `?project=<nombre>` era como se identificaba un proyecto; ahora es el slug. */
async function slugDe(nombre: string | undefined): Promise<string | null> {
  if (!nombre) return null;
  const p = await findProjectByName(nombre);
  return p?.slug ?? null;
}

const viejas: { ruta: string; seccion: string }[] = [
  { ruta: "/lint", seccion: "/health" },
  { ruta: "/pack", seccion: "/agents" },
  { ruta: "/graph", seccion: "/map" },
  { ruta: "/code", seccion: "/code" },
  { ruta: "/ask", seccion: "/ask" },
];

for (const { ruta, seccion } of viejas) {
  redirectRoutes.get(ruta, async (c) => {
    const slug = await slugDe(c.req.query("project"));
    if (!slug) return c.redirect("/", 302); // sin proyecto identificable, a elegir uno
    const q = c.req.query("q");
    return c.redirect(`/p/${slug}${seccion}${q ? `?q=${encodeURIComponent(q)}` : ""}`, 301);
  });
}

/** El antiguo listado de proyectos es ahora la portada. */
redirectRoutes.get("/projects", (c) => c.redirect("/", 301));

/** El coste pasó a ser cosa de operador. */
redirectRoutes.get("/usage", (c) => c.redirect("/admin/usage", 301));
