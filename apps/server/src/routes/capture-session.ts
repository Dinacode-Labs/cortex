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
 * `POST /capture/session` -- the client sends the **condensed** transcript and the server
 * distills it (ADR-0025).
 *
 * The division of labour is the whole point: condensing and scrubbing is cheap and the client
 * can do it; distilling needs LLM credentials and concurrency control, so whoever holds them
 * does it. That way no laptop needs a key.
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
    if (!user) return c.json({ error: "Not authenticated." }, 401);

    const body = await parseBody(c, captureSessionRequest);
    if (body instanceof Response) return body;

    // An outsized transcript is not a legitimate case: it is either a client bug or somebody
    // trying to make the server burn quota. It is cut off before touching the database.
    const maxChars = getEnvNum("CORTEX_CAPTURE_SESSION_MAX_CHARS", 150_000);
    if (body.condensed.length > maxChars) {
      return c.json({ error: `Transcript too large (${body.condensed.length} > ${maxChars} characters).` }, 413);
    }

    const access = await checkProjectAccess(user.email, { slug: body.slug });
    if (access.status === "not_found") return c.json({ error: "Project not found." }, 404);
    if (access.status === "forbidden") return c.json({ error: "No access to this project." }, 403);
    const project = access.project;

    const hash = hashCondensed(body.condensed);
    const previous = await findSessionCapture(project.id, body.platform, body.sessionId);

    // The same content already distilled: it is not paid for twice. This is the frequent case,
    // because the end-of-session and pre-compaction hooks fire over the same session.
    if (previous?.status === "done" && previous.condensedHash === hash) {
      const res: CaptureSessionResponse = { id: previous.id, status: "duplicate", counters: previous.counters as never };
      return c.json(res, 200);
    }
    // There is already work in flight for this session: no second job is queued.
    if (previous && (previous.status === "queued" || previous.status === "running")) {
      return c.json({ id: previous.id, status: previous.status } satisfies CaptureSessionResponse, 202);
    }

    // If the session grew, only the NEW tail is distilled: the condensed form is deterministic
    // and append-only, so the already-processed prefix adds nothing and does cost money.
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

    // By default it does not wait: the end-of-session hook has a short timeout and distilling
    // takes a while. `?wait=1` is for the batch connectors, which do want the counters.
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
      // The job stays alive; we merely stop waiting for it. The client can poll the id.
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
    if (!user) return c.json({ error: "Not authenticated." }, 401);
    const capture = await getSessionCaptureById(c.req.param("id"));
    if (!capture) return c.json({ error: "Not found." }, 404);
    return c.json({
      id: capture.id,
      status: capture.status,
      counters: capture.counters as never,
      ...(capture.error ? { error: capture.error } : {}),
    } satisfies CaptureSessionResponse);
  });

  return routes;
}

/** Runs one job from the queue and leaves the result recorded. */
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
