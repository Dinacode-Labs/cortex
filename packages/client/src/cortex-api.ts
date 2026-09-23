import type {
  CaptureRequest,
  CaptureSessionRequest,
  CaptureSessionResponse,
  ClientConfig,
  CreateProjectRequest,
  CreateProjectResponse,
  EntryDetailResponse,
  ProjectSummary,
  PurgeEntriesResponse,
  SearchRequest,
  SearchResponse,
  UpdateEntryRequest,
} from "@cortex/shared";
import { apiRequest, type ApiResult } from "./api-client.js";
import { readCredentials, writeCredentials, clearCredentials } from "./credentials.js";

/**
 * Typed client for the Cortex API. One function per endpoint, using the shared contract's
 * types (`@cortex/shared`), so the CLI and the hooks never build paths or parse responses by
 * hand.
 *
 * Everything here is pure HTTP: no Postgres, no LLM, nothing that would stop this being
 * bundled into a CLI installed with `npm i -g` (ADR-0025).
 *
 * **Rule when adding an endpoint or a field (ADR-0062):** the CLI and the server are NOT in
 * lockstep; this client may be talking to a server from months ago. What the server does not
 * know is "that feature is not there", not an error: a 404 on a new endpoint or a missing
 * field in the response means "old server", and the caller degrades (skips the feature, uses
 * the previous value, or says so clearly). Never assume a new field arrives; type anything
 * new as optional on the side that reads it.
 */

/** The configuration the server announces. `null` when it does not respond or is an older
 *  version that does not expose the endpoint yet: the caller decides the fallback. */
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

/** Single-use ticket for opening the web UI already authenticated. */
export function uiTicket(): Promise<ApiResult<{ ticket?: string }>> {
  return apiRequest("POST", "/auth/ui-ticket", {});
}

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

/** The project's rendered context pack. `null` with no session, no access or no server. */
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
 * Sends a condensed session for the server to distill.
 *
 * By default it does NOT wait (`202 queued`): end-of-session hooks have a short timeout and
 * distilling takes a while. With `wait` it waits for the result, which is what the batch
 * connectors want when they show counters.
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

// Re-exported for convenience: whoever uses the client almost always needs the credentials.
export { readCredentials, writeCredentials, clearCredentials };

export function searchEntries(input: SearchRequest): Promise<ApiResult<SearchResponse>> {
  const p = new URLSearchParams({ q: input.q });
  if (input.slug) p.set("slug", input.slug);
  if (input.type) p.set("type", input.type);
  if (input.limit) p.set("limit", String(input.limit));
  return apiRequest<SearchResponse>("GET", `/search?${p.toString()}`);
}

export function getEntry(id: string): Promise<ApiResult<EntryDetailResponse>> {
  return apiRequest<EntryDetailResponse>("GET", `/entries/${encodeURIComponent(id)}`);
}

export function updateEntry(id: string, body: UpdateEntryRequest): Promise<ApiResult<{ ok: boolean; id: string }>> {
  return apiRequest<{ ok: boolean; id: string }>("PATCH", `/entries/${encodeURIComponent(id)}`, body);
}

export function purgeEntries(ids: string[]): Promise<ApiResult<PurgeEntriesResponse>> {
  return apiRequest<PurgeEntriesResponse>("POST", "/entries/purge", { ids });
}
