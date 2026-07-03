import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono, type Context } from "hono";
import {
  captureBatch,
  checkEntryAccess,
  checkProjectAccess,
  createUiTicket,
  getContextPack,
  listAccessibleProjects,
  relateEntries,
  renderContextPack,
  requestOtp,
  revokeToken,
  saveWithReconciliation,
  validateToken,
  verifyOtp,
  type AuthUser,
  type BatchItem,
} from "@cortex/core";

/**
 * API HTTP de Cortex (Hono). Autenticación email + OTP + endpoints autenticados de
 * contexto (los hooks/conectores los usan en vez de tocar la BD directamente): la
 * escritura se atribuye al usuario (created_by = email) y respeta permisos. Ver
 * docs/decisions.md.
 *
 * Este módulo NO tiene efectos al importar (ni loadEnv ni serve): `createApp()`
 * construye la app completa y el entrypoint fino (`index.ts`) la arranca. Así los
 * tests pueden ejercitar las rutas con `app.request()` sin levantar un servidor.
 */

/** Construye la API HTTP completa (auth + contexto). Sin side effects. */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "cortex-server" }));

  // Instalador (curl -fsSL <servidor>/install.sh | sh). Inyecta la URL del servidor.
  const INSTALL_SH = resolve(import.meta.dirname, "../../../scripts/install.sh");
  app.get("/install.sh", (c) => {
    let sh: string;
    try {
      sh = readFileSync(INSTALL_SH, "utf8");
    } catch {
      return c.text("# install.sh no disponible", 500);
    }
    const publicUrl = process.env.CORTEX_PUBLIC_URL || new URL(c.req.url).origin;
    return c.body(sh.replaceAll("__CORTEX_SERVER_URL__", publicUrl), 200, { "content-type": "text/x-shellscript; charset=utf-8" });
  });

  // --- Auth (email + OTP) ------------------------------------------------------
  app.post("/auth/request", async (c) => {
    const { email } = await c.req.json().catch(() => ({}) as { email?: string });
    if (!email) return c.json({ error: "Falta 'email'." }, 400);
    try {
      await requestOtp(email);
      return c.json({ ok: true }); // no revelamos si el email existe
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post("/auth/verify", async (c) => {
    const { email, code } = await c.req.json().catch(() => ({}) as { email?: string; code?: string });
    if (!email || !code) return c.json({ error: "Faltan 'email' y/o 'code'." }, 400);
    try {
      const { token, user } = await verifyOtp(email, code);
      return c.json({ token, user });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 401);
    }
  });

  function bearer(c: Context): string | null {
    const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
    return m ? m[1]!.trim() : null;
  }

  async function currentUser(c: Context): Promise<AuthUser | null> {
    const token = bearer(c);
    return token ? validateToken(token) : null;
  }

  app.get("/auth/me", async (c) => {
    const user = await currentUser(c);
    return user ? c.json({ user }) : c.json({ error: "No autenticado." }, 401);
  });

  // Ticket de un solo uso para abrir la UI (cortex ui). El token de CLI no viaja en la URL.
  app.post("/auth/ui-ticket", async (c) => {
    const token = bearer(c);
    const ticket = token ? await createUiTicket(token) : null;
    return ticket ? c.json({ ticket }) : c.json({ error: "No autenticado." }, 401);
  });

  app.post("/auth/logout", async (c) => {
    const token = bearer(c);
    if (token) await revokeToken(token);
    return c.json({ ok: true });
  });

  // --- Contexto (autenticado; sustituye el acceso directo a BD de hooks/conectores) ----

  /** Inyección de contexto (hook SessionStart): pack del proyecto vinculado, con acceso. */
  app.get("/context-pack", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "No autenticado." }, 401);
    const slug = c.req.query("slug") ?? "";
    if (!slug) return c.json({ error: "Proyecto no encontrado." }, 404);
    const access = await checkProjectAccess(user.email, { slug });
    if (access.status === "not_found") return c.json({ error: "Proyecto no encontrado." }, 404);
    if (access.status === "forbidden") return c.json({ error: "Sin acceso." }, 403);
    const project = access.project;
    try {
      const text = renderContextPack(await getContextPack(project.name));
      return c.json({ project: project.name, text });
    } catch {
      return c.json({ project: project.name, text: "" });
    }
  });

  /** Captura autenticada (hook SessionEnd / conectores): guarda con reconciliación y
   *  atribución (created_by = email). Respeta permisos del proyecto. */
  app.post("/capture", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "No autenticado." }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      slug?: string;
      title?: string;
      content?: string;
      type?: string;
      sourceType?: string;
      sourceReference?: string;
      confidence?: string;
      metadata?: Record<string, unknown>;
    };
    if (!body.slug || !body.content) return c.json({ error: "Faltan 'slug' y/o 'content'." }, 400);
    const access = await checkProjectAccess(user.email, { slug: body.slug });
    if (access.status === "not_found") return c.json({ error: "Proyecto no encontrado." }, 404);
    if (access.status === "forbidden") return c.json({ error: "Sin acceso." }, 403);
    const project = access.project;
    try {
      const r = await saveWithReconciliation(
        {
          content: body.content,
          project: project.name,
          title: body.title,
          type: (body.type as never) || undefined,
          confidence: (body.confidence as never) || "low",
          sourceType: (body.sourceType as never) || "manual",
          sourceReference: body.sourceReference,
          createdBy: user.email, // ATRIBUCIÓN: quién metió el dato
          metadata: body.metadata,
        } as never,
        { useClassifier: false, detectImprovements: false, skipEmbedding: false },
      );
      return c.json(r);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  /** Captura por LOTES (conectores): N items, embedding por lotes, atribución. */
  app.post("/capture/batch", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "No autenticado." }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { slug?: string; items?: BatchItem[] };
    if (!body.slug || !Array.isArray(body.items)) return c.json({ error: "Faltan 'slug' y/o 'items'." }, 400);
    const access = await checkProjectAccess(user.email, { slug: body.slug });
    if (access.status === "not_found") return c.json({ error: "Proyecto no encontrado." }, 404);
    if (access.status === "forbidden") return c.json({ error: "Sin acceso." }, 403);
    const project = access.project;
    try {
      const results = await captureBatch(project.name, body.items, user.email);
      return c.json({ results });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  /** Relación entre entradas (p.ej. adjunto belongs_to su página). Autenticado. */
  app.post("/relate", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "No autenticado." }, 401);
    const b = (await c.req.json().catch(() => ({}))) as { sourceId?: string; targetId?: string; relationType?: string };
    if (!b.sourceId || !b.targetId || !b.relationType) return c.json({ error: "Faltan sourceId/targetId/relationType." }, 400);
    // Permiso por entrada (no por nombre de proyecto): hay que poder acceder a AMBAS.
    // Entrada sin proyecto → se permite (no hay permisos que aplicar).
    for (const eid of [b.sourceId, b.targetId]) {
      const access = await checkEntryAccess(user.email, eid);
      if (access.status === "not_found") return c.json({ error: "Entrada no encontrada." }, 404);
      if (access.status === "forbidden") return c.json({ error: "Sin acceso." }, 403);
    }
    try {
      await relateEntries(b.sourceId, b.targetId, b.relationType as never);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  /** Proyectos visibles para el usuario (admin → todos). */
  app.get("/projects", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "No autenticado." }, 401);
    const projects = await listAccessibleProjects(user.email);
    return c.json({ projects: projects.map((p) => ({ slug: p.slug, name: p.name, visibility: p.visibility })) });
  });

  return app;
}
