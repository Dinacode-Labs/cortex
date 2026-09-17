import type {
  CaptureRequest,
  CaptureSessionRequest,
  CaptureSessionResponse,
  ClientConfig,
  CreateProjectRequest,
  CreateProjectResponse,
  EntryDetailResponse,
  ProjectSummary,
  SearchRequest,
  SearchResponse,
  UpdateEntryRequest,
} from "@cortex/shared";
import { apiRequest, type ApiResult } from "./api-client.js";
import { readCredentials, writeCredentials, clearCredentials } from "./credentials.js";

/**
 * Cliente tipado de la API de Cortex. Una función por endpoint, con los tipos del contrato
 * compartido (`@cortex/shared`), para que el CLI y los hooks no construyan rutas ni parseen
 * respuestas a mano.
 *
 * Todo lo que hay aquí es HTTP puro: ni Postgres, ni LLM, ni nada que impida empaquetar
 * esto en un CLI que se instala con `npm i -g` (ADR-0025).
 *
 * **Regla al añadir un endpoint o un campo (ADR-0062):** el CLI y el servidor NO van en
 * lockstep; este cliente puede estar hablando con un servidor de hace meses. Lo que el
 * servidor no conoce es «esa función no está», no un error: un 404 en un endpoint nuevo o un
 * campo ausente en la respuesta significa «servidor viejo» y el llamador se degrada (omite la
 * función, usa el valor de antes, o lo dice con claridad). Nunca asumas que un campo nuevo
 * viene; tipa lo nuevo como opcional en el lado que lo lee.
 */

// --- Meta -----------------------------------------------------------------------------

/** Configuración que anuncia el servidor. `null` si no responde o es una versión antigua
 *  que aún no expone el endpoint: el llamador decide el fallback. */
export async function getClientConfig(server?: string): Promise<ClientConfig | null> {
  const res = await apiRequest<ClientConfig>("GET", "/client-config", undefined, {
    auth: false,
    baseUrl: server,
  });
  return res.ok ? res.data : null;
}

export async function getServerVersion(): Promise<string | null> {
  const res = await apiRequest<{ version: string }>("GET", "/version", undefined, { auth: false });
  return res.ok ? res.data.version : null;
}

// --- Auth -----------------------------------------------------------------------------

export function requestOtpCode(server: string, email: string): Promise<ApiResult<{ ok?: boolean }>> {
  return apiRequest("POST", "/auth/request", { email }, { auth: false, baseUrl: server });
}

export function verifyOtpCode(
  server: string,
  email: string,
  code: string,
): Promise<ApiResult<{ token?: string; user?: { email: string; admin: boolean }; error?: string }>> {
  return apiRequest("POST", "/auth/verify", { email, code }, { auth: false, baseUrl: server });
}

export function whoami(): Promise<ApiResult<{ user?: { email: string; admin: boolean } }>> {
  return apiRequest("GET", "/auth/me");
}

export function logout(): Promise<ApiResult<unknown>> {
  return apiRequest("POST", "/auth/logout", {});
}

/** Ticket de un solo uso para abrir la UI web ya autenticada. */
export function uiTicket(): Promise<ApiResult<{ ticket?: string }>> {
  return apiRequest("POST", "/auth/ui-ticket", {});
}

// --- Proyectos ------------------------------------------------------------------------

export function listProjects(): Promise<ApiResult<{ projects: ProjectSummary[] }>> {
  return apiRequest("GET", "/projects");
}

export function getProject(slug: string): Promise<ApiResult<{ project: ProjectSummary }>> {
  return apiRequest("GET", `/projects/${encodeURIComponent(slug)}`);
}

export function createProject(
  body: CreateProjectRequest,
): Promise<ApiResult<CreateProjectResponse & { error?: string; admins?: string[] }>> {
  return apiRequest("POST", "/projects", body);
}

// --- Contexto -------------------------------------------------------------------------

/** Context pack renderizado del proyecto. `null` si no hay sesión, acceso o servidor. */
export async function getContextPack(slug: string): Promise<{ project: string; text: string } | null> {
  const res = await apiRequest<{ project: string; text: string }>(
    "GET",
    `/context-pack?slug=${encodeURIComponent(slug)}`,
  );
  return res.ok ? res.data : null;
}

export function capture(body: CaptureRequest): Promise<ApiResult<{ action?: string }>> {
  return apiRequest("POST", "/capture", body);
}

/**
 * Manda una sesión condensada para que el servidor la destile.
 *
 * Por defecto NO espera (`202 queued`): los hooks de fin de sesión tienen un timeout corto
 * y destilar lleva su tiempo. Con `wait` se espera al resultado, que es lo que quieren los
 * conectores por lotes cuando muestran contadores.
 */
export function captureSession(
  body: CaptureSessionRequest,
  opts: { wait?: boolean } = {},
): Promise<ApiResult<CaptureSessionResponse>> {
  return apiRequest("POST", `/capture/session${opts.wait ? "?wait=1" : ""}`, body, {
    timeoutMs: opts.wait ? 180_000 : undefined,
  });
}

export function getCaptureSession(id: string): Promise<ApiResult<CaptureSessionResponse>> {
  return apiRequest("GET", `/capture/session/${encodeURIComponent(id)}`);
}

// Re-export por comodidad: quien usa el cliente casi siempre necesita las credenciales.
export { readCredentials, writeCredentials, clearCredentials };

// --- Lectura: búsqueda y acceso por id -------------------------------------------------

/** Búsqueda híbrida. Sin `slug`, en todo lo accesible; con `slug`, solo en ese proyecto. */
export function searchEntries(input: SearchRequest): Promise<ApiResult<SearchResponse>> {
  const p = new URLSearchParams({ q: input.q });
  if (input.slug) p.set("slug", input.slug);
  if (input.type) p.set("type", input.type);
  if (input.limit) p.set("limit", String(input.limit));
  return apiRequest<SearchResponse>("GET", `/search?${p.toString()}`);
}

/** Una entrada por id, con su trazabilidad. */
export function getEntry(id: string): Promise<ApiResult<EntryDetailResponse>> {
  return apiRequest<EntryDetailResponse>("GET", `/entries/${encodeURIComponent(id)}`);
}

/** Corrige título y/o contenido de una entrada. */
export function updateEntry(id: string, body: UpdateEntryRequest): Promise<ApiResult<{ ok: boolean; id: string }>> {
  return apiRequest<{ ok: boolean; id: string }>("PATCH", `/entries/${encodeURIComponent(id)}`, body);
}
