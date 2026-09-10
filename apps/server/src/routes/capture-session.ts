import { Hono } from "hono";
import {
  checkProjectAccess,
  findSessionCapture,
  getSessionCaptureById,
  hashCondensed,
  markSessionCapture,
  upsertSessionCapture,
} from "@cortex/core";
import { captureSessionRequest, getEnvNum, type CaptureSessionResponse } from "@cortex/shared";
import type { DistillSessionFn } from "@cortex/agents";
import { currentUser } from "../auth-helpers.js";
import { parseBody } from "../validate.js";
import type { CaptureQueue } from "../capture-queue.js";

/**
 * `POST /capture/session` — el cliente manda el transcript **condensado** y el servidor lo
 * destila (ADR-0025).
 *
 * El reparto de trabajo es el punto: condensar y escrubar es barato y puede hacerlo el
 * cliente; destilar necesita credenciales de LLM y control de concurrencia, así que lo hace
 * quien las tiene. Así ningún portátil necesita una clave.
 */

export interface CaptureJob {
  captureId: string;
  projectName: string;
  condensed: string;
  platform: string;
  sessionId: string;
  createdBy: string;
  sourceType?: string;
}

export function captureSessionRoutes(deps: { distill: DistillSessionFn; queue: CaptureQueue<CaptureJob> }): Hono {
  const routes = new Hono();

  routes.post("/capture/session", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "No autenticado." }, 401);

    const body = await parseBody(c, captureSessionRequest);
    if (body instanceof Response) return body;

    // Un transcript desmedido no es un caso legítimo: o es un error del cliente o alguien
    // intentando que el servidor queme cuota. Se corta antes de tocar la BD.
    const maxChars = getEnvNum("CORTEX_CAPTURE_SESSION_MAX_CHARS", 150_000);
    if (body.condensed.length > maxChars) {
      return c.json({ error: `Transcript demasiado grande (${body.condensed.length} > ${maxChars} caracteres).` }, 413);
    }

    const access = await checkProjectAccess(user.email, { slug: body.slug });
    if (access.status === "not_found") return c.json({ error: "Proyecto no encontrado." }, 404);
    if (access.status === "forbidden") return c.json({ error: "Sin acceso." }, 403);
    const project = access.project;

    const hash = hashCondensed(body.condensed);
    const previous = await findSessionCapture(project.id, body.platform, body.sessionId);

    // Mismo contenido ya destilado: no se vuelve a pagar. Es el caso frecuente, porque los
    // hooks de fin de sesión y de pre-compactación disparan sobre la misma sesión.
    if (previous?.status === "done" && previous.condensedHash === hash) {
      const res: CaptureSessionResponse = { id: previous.id, status: "duplicate", counters: previous.counters as never };
      return c.json(res, 200);
    }
    // Ya hay trabajo en marcha para esta sesión: no se encola otro.
    if (previous && (previous.status === "queued" || previous.status === "running")) {
      return c.json({ id: previous.id, status: previous.status } satisfies CaptureSessionResponse, 202);
    }

    // Si la sesión creció, se destila SOLO la cola nueva: el condensado es determinista y
    // append-only, así que el prefijo ya procesado no aporta nada y sí cuesta dinero.
    const delta =
      previous?.status === "done" && body.condensed.length > previous.condensedChars
        ? body.condensed.slice(previous.condensedChars)
        : body.condensed;

    const { id } = await upsertSessionCapture({
      projectId: project.id,
      platform: body.platform,
      sessionId: body.sessionId,
      userEmail: user.email,
      hash,
      chars: body.condensed.length,
    });

    const done = deps.queue.enqueue({
      captureId: id,
      projectName: project.name,
      condensed: delta,
      platform: body.platform,
      sessionId: body.sessionId,
      createdBy: user.email,
      sourceType: body.sourceType,
    });

    // Por defecto no se espera: el hook de fin de sesión tiene un timeout corto y destilar
    // tarda. `?wait=1` es para los conectores por lotes, que sí quieren los contadores.
    if (c.req.query("wait") !== "1") {
      return c.json({ id, status: "queued" } satisfies CaptureSessionResponse, 202);
    }

    const waitMs = getEnvNum("CORTEX_CAPTURE_WAIT_MS", 120_000);
    const timedOut = Symbol("timeout");
    const outcome = await Promise.race([
      done.then(() => "done" as const),
      new Promise<typeof timedOut>((r) => setTimeout(() => r(timedOut), waitMs)),
    ]);
    if (outcome === timedOut) {
      // El trabajo sigue vivo; solo dejamos de esperarlo. El cliente puede consultar el id.
      return c.json({ id, status: "running" } satisfies CaptureSessionResponse, 202);
    }
    const finished = await getSessionCaptureById(id);
    return c.json({
      id,
      status: finished?.status === "failed" ? "failed" : "done",
      counters: finished?.counters as never,
      ...(finished?.error ? { error: finished.error } : {}),
    } satisfies CaptureSessionResponse);
  });

  routes.get("/capture/session/:id", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "No autenticado." }, 401);
    const capture = await getSessionCaptureById(c.req.param("id"));
    if (!capture) return c.json({ error: "No encontrado." }, 404);
    return c.json({
      id: capture.id,
      status: capture.status,
      counters: capture.counters as never,
      ...(capture.error ? { error: capture.error } : {}),
    } satisfies CaptureSessionResponse);
  });

  return routes;
}

/** Ejecuta un trabajo de la cola y deja el resultado registrado. */
export function makeCaptureRunner(distill: DistillSessionFn) {
  return async (job: CaptureJob): Promise<void> => {
    await markSessionCapture(job.captureId, "running");
    try {
      const counters = await distill({
        projectName: job.projectName,
        condensed: job.condensed,
        platform: job.platform,
        sessionId: job.sessionId,
        createdBy: job.createdBy,
        sourceType: job.sourceType as never,
      });
      await markSessionCapture(job.captureId, "done", counters);
    } catch (e) {
      await markSessionCapture(job.captureId, "failed", undefined, (e as Error).message);
      throw e;
    }
  };
}
