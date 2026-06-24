import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { closeSql } from "@cortex/database";
import { loadEnv } from "@cortex/shared";
import {
  canAccessProject,
  findProjectBySlug,
  getContextPack,
  listAccessibleProjects,
  renderContextPack,
  requestOtp,
  revokeToken,
  saveWithReconciliation,
  validateToken,
  verifyOtp,
  type AuthUser,
} from "@cortex/core";
import { isLlmEnabled, wireReconciler } from "@cortex/agents";

/**
 * API HTTP de Cortex (Hono). Autenticación email + OTP + endpoints autenticados de
 * contexto (los hooks/conectores los usan en vez de tocar la BD directamente): la
 * escritura se atribuye al usuario (created_by = email) y respeta permisos. Ver
 * docs/decisions.md.
 */
loadEnv();
if (isLlmEnabled()) wireReconciler(); // reconciliación LLM (ADD/UPDATE/SUPERSEDE/NOOP) en /capture

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "cortex-server" }));

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
  const project = slug ? await findProjectBySlug(slug) : null;
  if (!project) return c.json({ error: "Proyecto no encontrado." }, 404);
  if (!(await canAccessProject(project, user.email))) return c.json({ error: "Sin acceso." }, 403);
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
  const project = await findProjectBySlug(body.slug);
  if (!project) return c.json({ error: "Proyecto no encontrado." }, 404);
  if (!(await canAccessProject(project, user.email))) return c.json({ error: "Sin acceso." }, 403);
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

/** Proyectos visibles para el usuario (admin → todos). */
app.get("/projects", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "No autenticado." }, 401);
  const projects = await listAccessibleProjects(user.email);
  return c.json({ projects: projects.map((p) => ({ slug: p.slug, name: p.name, visibility: p.visibility })) });
});

const port = Number(process.env.CORTEX_SERVER_PORT ?? "8787");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cortex server escuchando en http://localhost:${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await closeSql();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
