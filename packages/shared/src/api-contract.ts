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
  /** Versión del servidor. Solo informativa: el CLI la compara con la suya para avisar. */
  version: z.string(),
  /** Versión mínima de CLI que este servidor admite; por debajo, el CLI se niega a escribir (ADR-0060). */
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

/**
 * Lo que un proyecto puede cambiar después de nacer (ADR-0051). Los dos campos son
 * opcionales y se aplican solo si vienen: mandar `{}` no borra el dueño. Para quitarlo
 * hay que decirlo con `ownerEmail: null`, que es una decisión distinta de no mencionarlo.
 */
export const updateProjectRequest = z.object({
  visibility: z.enum(["public", "private"]).optional(),
  ownerEmail: z.string().email().nullable().optional(),
  /** Colgar de otro proyecto, o `null` para dejarlo suelto. */
  parentSlug: z.string().nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequest>;

export const projectMemberRequest = z.object({ email: z.string().email() });
export type ProjectMemberRequest = z.infer<typeof projectMemberRequest>;

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
  /**
   * Caracteres de la sesión que no se han destilado, cuando no cabía entera. Opcional porque
   * las capturas anteriores a esto no lo tienen: su ausencia significa «no se sabe», no «cero».
   */
  droppedChars: z.number().optional(),
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

// --- Búsqueda y acceso por id ---------------------------------------------------------
//
// La API sabía escribir (`/capture`) pero no leer: buscar solo existía por MCP, contra la
// base de datos. Eso dejaba fuera al CLI y a cualquier integración que no sea un agente con
// MCP, como las tools de memoria que Cortex registra en Pi (ADR-0034).

export const searchRequest = z.object({
  q: z.string().min(1),
  /** Sin slug se busca en todo lo accesible; con slug, solo en ese proyecto. */
  slug: z.string().optional(),
  type: contextEntryType.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type SearchRequest = z.infer<typeof searchRequest>;

export const searchHitSummary = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  type: z.string(),
  projectId: z.string().nullable(),
  confidence: z.string().nullable(),
  status: z.string().nullable(),
  score: z.number().nullable(),
});
export type SearchHitSummary = z.infer<typeof searchHitSummary>;

export const searchResponse = z.object({ hits: z.array(searchHitSummary) });
export type SearchResponse = z.infer<typeof searchResponse>;

/**
 * Actualización de una entrada por id. Solo `title` y `content`: el resto (tipo, confianza,
 * vigencia) lo decide la reconciliación o el lint, no quien llama por la API. Cambiar el
 * contenido vuelve a calcular el embedding, así que la entrada sigue siendo encontrable.
 */
export const updateEntryRequest = z
  .object({ title: z.string().min(1).optional(), content: z.string().min(1).optional() })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: "Nothing to update: pass title, content, or both.",
  });
export type UpdateEntryRequest = z.infer<typeof updateEntryRequest>;

/**
 * `GET /entries/:id` devuelve el `EntryDetail` de core tal cual. El cliente no necesita
 * conocer su forma entera —la usa para mostrarla—, así que aquí solo se fija lo que sí se
 * lee por código; el resto viaja igualmente.
 */
export interface EntryDetailResponse {
  entry: { id: string; title?: string | null; content: string; type: string; status?: string | null; confidence?: string | null };
  [k: string]: unknown;
}
