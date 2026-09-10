import { z } from "zod";
import { confidenceLevel, contextEntryType, sourceType } from "./domain.js";

/**
 * Contrato de la API HTTP: los schemas que comparten servidor y cliente.
 *
 * Viven en `shared` y no en el servidor ni en el cliente porque los necesitan los dos, y
 * tenerlos en un solo sitio es lo que evita que se desincronicen en silencio: el servidor
 * valida el body con el mismo schema con el que el cliente lo construye.
 *
 * zod v3 (el del resto del repo; `agents` usa v4 porque lo exige Mastra, aislado — ADR-0008).
 */

// --- Configuración que el servidor anuncia a sus clientes -----------------------------

export const clientConfig = z.object({
  /** Base de la API (puede llevar prefijo de ruta si hay un proxy delante). */
  apiUrl: z.string(),
  /** URL del MCP por HTTP, para que el CLI no tenga que adivinarla. */
  mcpUrl: z.string(),
  webUrl: z.string(),
  version: z.string(),
  /** Versión mínima de CLI que este servidor admite; por debajo, avisa de actualizar. */
  minClientVersion: z.string(),
});
export type ClientConfig = z.infer<typeof clientConfig>;

// --- Proyectos ------------------------------------------------------------------------

export const projectSummary = z.object({
  slug: z.string(),
  name: z.string(),
  visibility: z.enum(["public", "private"]),
});
export type ProjectSummary = z.infer<typeof projectSummary>;

export const createProjectRequest = z.object({
  name: z.string().min(1).max(120),
  visibility: z.enum(["public", "private"]).optional(),
  /** Cuelga el proyecto de otro (hereda contexto y permisos). */
  parentSlug: z.string().optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequest>;

export const createProjectResponse = z.object({
  project: projectSummary,
  /** false = ya existía y tienes acceso; no se crea un duplicado. */
  created: z.boolean(),
});
export type CreateProjectResponse = z.infer<typeof createProjectResponse>;

// --- Captura de una sesión de agente --------------------------------------------------

export const capturePlatform = z.enum(["claude", "codex", "opencode", "hermes", "pi", "meeting", "other"]);
export type CapturePlatform = z.infer<typeof capturePlatform>;

/**
 * El cliente manda el transcript ya **condensado y escrubado**; destilar es cosa del
 * servidor, que es quien tiene las credenciales del modelo (ADR-0025).
 */
export const captureSessionRequest = z.object({
  slug: z.string().min(1),
  platform: capturePlatform,
  sessionId: z.string().min(1).max(200),
  condensed: z.string().min(1),
  sourceType: sourceType.optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CaptureSessionRequest = z.infer<typeof captureSessionRequest>;

export const captureSessionCounters = z.object({
  saved: z.number(),
  updated: z.number(),
  superseded: z.number(),
  noop: z.number(),
  failed: z.number(),
  windows: z.number(),
});
export type CaptureSessionCounters = z.infer<typeof captureSessionCounters>;

export const captureSessionResponse = z.object({
  id: z.string(),
  /** `duplicate` = esta sesión ya se destiló con el mismo contenido; no se repite el gasto. */
  status: z.enum(["queued", "running", "done", "failed", "duplicate"]),
  counters: captureSessionCounters.optional(),
  error: z.string().optional(),
});
export type CaptureSessionResponse = z.infer<typeof captureSessionResponse>;

// --- Captura suelta (una pieza de conocimiento) ---------------------------------------

export const captureRequest = z.object({
  slug: z.string().min(1),
  content: z.string().min(1),
  title: z.string().optional(),
  type: contextEntryType.optional(),
  confidence: confidenceLevel.optional(),
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CaptureRequest = z.infer<typeof captureRequest>;

// --- Captura por lotes (conectores) ---------------------------------------------------

/**
 * Un item de `POST /capture/batch`. Los campos de enumeración van como `string` a
 * propósito: los conectores construyen items a partir de fuentes externas y el servidor es
 * quien valida contra los enums del dominio. Así un conector no necesita importar `core`.
 */
export interface BatchItem {
  title?: string;
  content: string;
  type?: string;
  sourceType?: string;
  sourceReference?: string;
  confidence?: string;
  metadata?: Record<string, unknown>;
}
