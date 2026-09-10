import { Hono } from "hono";
import { z } from "zod";
import {
  captureBatch,
  checkEntryAccess,
  checkProjectAccess,
  getContextPack,
  relateEntries,
  renderContextPack,
  saveWithReconciliation,
} from "@cortex/core";
import { confidenceLevel, contextEntryType, relationType, sourceType } from "@cortex/shared";
import { currentUser } from "../auth-helpers.js";
import { parseBody } from "../validate.js";

/**
 * Rutas de contexto autenticadas (sustituyen el acceso directo a BD de
 * hooks/conectores): la escritura se atribuye al usuario (created_by = email)
 * y respeta permisos. Los errores no controlados suben al onError de app.ts.
 */
export const contextRoutes = new Hono();

// --- Schemas de REQUEST (zod v3) ----------------------------------------------
// Los enums vienen de @cortex/shared: los valores que envían los conectores reales
// (document, github_pr/github_issue, notion_doc, meeting_transcript, agent_session;
// pr_summary/ticket_resolution/incident; belongs_to) están todos dentro del enum.
// Los campos antes tolerados como opcionales siguen opcionales.

const captureSchema = z.object({
  slug: z.string().min(1),
  content: z.string().min(1),
  title: z.string().optional(),
  type: contextEntryType.optional(),
  confidence: confidenceLevel.optional(),
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  metadata: z.record(z.unknown()).optional(), // Record abierto, como hasta ahora
});

// Mismo shape que BatchItem de @cortex/core (allí tipado como strings laxos).
const batchItemSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1),
  type: contextEntryType.optional(),
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  confidence: confidenceLevel.optional(),
  metadata: z.record(z.unknown()).optional(),
});

const captureBatchSchema = z.object({
  slug: z.string().min(1),
  items: z.array(batchItemSchema),
});

const relateSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationType: relationType,
});

// --- Rutas ---------------------------------------------------------------------

/** Inyección de contexto (hook SessionStart): pack del proyecto vinculado, con acceso. */
contextRoutes.get("/context-pack", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const slug = c.req.query("slug") ?? "";
  if (!slug) return c.json({ error: "Project not found." }, 404);
  const access = await checkProjectAccess(user.email, { slug });
  if (access.status === "not_found") return c.json({ error: "Project not found." }, 404);
  if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  const project = access.project;
  try {
    const text = renderContextPack(await getContextPack(project.name));
    return c.json({ project: project.name, text });
  } catch (e) {
    // SOLO la carrera guard→consulta: el proyecto puede desaparecer/renombrarse entre
    // checkProjectAccess y getContextPack ("Proyecto no encontrado: ..."). En ese caso
    // conservamos el contrato del hook (pack vacío, la sesión no se rompe). Cualquier
    // otro error sube al onError de app.ts (antes se tragaba TODO aquí).
    if (e instanceof Error && e.message.startsWith("Proyecto no encontrado")) {
      return c.json({ project: project.name, text: "" });
    }
    throw e;
  }
});

/** Captura autenticada (hook SessionEnd / conectores): guarda con reconciliación y
 *  atribución (created_by = email). Respeta permisos del proyecto. */
contextRoutes.post("/capture", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, captureSchema);
  if (body instanceof Response) return body;
  const access = await checkProjectAccess(user.email, { slug: body.slug });
  if (access.status === "not_found") return c.json({ error: "Project not found." }, 404);
  if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  const project = access.project;
  // Sin try/catch: un fallo interno sube al onError (500 genérico; el mensaje
  // interno ya no se filtra al cliente — los conectores solo miran r.ok).
  const r = await saveWithReconciliation(
    {
      content: body.content,
      project: project.name,
      title: body.title,
      type: body.type,
      confidence: body.confidence ?? "low",
      sourceType: body.sourceType ?? "manual",
      sourceReference: body.sourceReference,
      createdBy: user.email, // ATRIBUCIÓN: quién metió el dato
      metadata: body.metadata,
    },
    { useClassifier: false, detectImprovements: false, skipEmbedding: false },
  );
  return c.json(r);
});

/** Captura por LOTES (conectores): N items, embedding por lotes, atribución. */
contextRoutes.post("/capture/batch", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, captureBatchSchema);
  if (body instanceof Response) return body;
  const access = await checkProjectAccess(user.email, { slug: body.slug });
  if (access.status === "not_found") return c.json({ error: "Project not found." }, 404);
  if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  const project = access.project;
  const results = await captureBatch(project.name, body.items, user.email);
  return c.json({ results });
});

/** Relación entre entradas (p.ej. adjunto belongs_to su página). Autenticado. */
contextRoutes.post("/relate", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, relateSchema);
  if (body instanceof Response) return body;
  // Permiso por entrada (no por nombre de proyecto): hay que poder acceder a AMBAS.
  // Entrada sin proyecto → se permite (no hay permisos que aplicar).
  for (const eid of [body.sourceId, body.targetId]) {
    const access = await checkEntryAccess(user.email, eid);
    if (access.status === "not_found") return c.json({ error: "Entry not found." }, 404);
    if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
  }
  await relateEntries(body.sourceId, body.targetId, body.relationType);
  return c.json({ ok: true });
});
