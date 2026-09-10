import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CapturePlatform, CaptureSessionCounters, SourceType } from "@cortex/shared";
import { captureSession } from "./cortex-api.js";
import { condenseSession } from "./transcript-utils.js";
import { readSessions } from "./session-readers.js";

/** Plataformas de agente con lector de sesiones. */
export type CapturePlatformName = CapturePlatform;

/**
 * Envío de sesiones de agente al servidor para que las destile (ADR-0025).
 *
 * El cliente hace lo barato —leer el transcript y condensarlo a diálogo útil, sin tool
 * calls ni volcados— y el servidor hace lo caro. Antes esto destilaba aquí mismo, lo que
 * obligaba a que cada portátil tuviera una clave de LLM en el `.env` de un repo clonado.
 *
 * Vive en `client` y no en `agents` justamente por eso: ya no necesita el modelo.
 */

export interface SessionCaptureOutcome {
  sessionId: string;
  status: string;
  counters?: CaptureSessionCounters;
  error?: string;
}

/** Manda un transcript ya condensado. Por defecto no espera al resultado. */
export async function sendCondensedSession(opts: {
  slug: string;
  condensed: string;
  sessionId: string;
  platform: CapturePlatform;
  sourceType?: SourceType;
  wait?: boolean;
}): Promise<SessionCaptureOutcome> {
  const res = await captureSession(
    {
      slug: opts.slug,
      platform: opts.platform,
      sessionId: opts.sessionId,
      condensed: opts.condensed,
      ...(opts.sourceType ? { sourceType: opts.sourceType } : {}),
    },
    { wait: opts.wait },
  );
  if (!res.ok) {
    const error = (res.data as { error?: string })?.error ?? `HTTP ${res.status}`;
    return { sessionId: opts.sessionId, status: "failed", error };
  }
  return { sessionId: opts.sessionId, status: res.data.status, counters: res.data.counters };
}

/** Auto-captura del hook: lee el transcript `.jsonl`, lo condensa y lo manda. */
export function sendSessionFile(
  slug: string,
  file: string,
  platform: CapturePlatform = "claude",
): Promise<SessionCaptureOutcome> {
  const sessionId = file.split("/").pop()!.replace(/\.jsonl$/, "");
  return sendCondensedSession({ slug, condensed: condenseSession(file), sessionId, platform });
}

/** Transcripts de Claude Code de un repo, del más reciente al más antiguo. */
export function readClaudeSessions(repoPath: string, limit?: number): { sessionId: string; condensed: string }[] {
  const folder = join(homedir(), ".claude/projects", repoPath.replace(/[^a-zA-Z0-9]/g, "-"));
  if (!existsSync(folder)) return [];
  let files = readdirSync(folder)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(folder, f));
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (limit) files = files.slice(0, limit);
  return files.map((f) => ({
    sessionId: f.split("/").pop()!.replace(/\.jsonl$/, ""),
    condensed: condenseSession(f),
  }));
}

/**
 * Backfill retroactivo de las sesiones de un repo. Espera a cada una (`wait`) porque el
 * usuario está mirando los contadores; el hook, que corre en silencio, no espera.
 */
export async function backfillSessions(
  slug: string,
  repoPath: string,
  platform: CapturePlatform,
  opts: { limit?: number; log?: (line: string) => void } = {},
): Promise<{ sessions: number; counters: CaptureSessionCounters }> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const sessions =
    platform === "claude"
      ? readClaudeSessions(repoPath, opts.limit)
      : (await readSessions(platform, repoPath)).slice(0, opts.limit ?? Infinity);

  const total: CaptureSessionCounters = { saved: 0, updated: 0, superseded: 0, noop: 0, failed: 0, windows: 0 };
  if (sessions.length === 0) {
    log(`No hay sesiones de ${platform} para ${repoPath}.`);
    return { sessions: 0, counters: total };
  }
  log(`${sessions.length} sesiones (${platform}) para ${repoPath}. El servidor las destilará → "${slug}"...`);

  for (const s of sessions) {
    const r = await sendCondensedSession({ ...s, slug, platform, wait: true });
    const c = r.counters;
    if (c) for (const k of Object.keys(total) as (keyof CaptureSessionCounters)[]) total[k] += c[k] ?? 0;
    const detalle = c
      ? `+${c.saved} nuevas, ~${c.updated} fusionadas, ⊘${c.superseded} superadas${c.failed ? `, ${c.failed} fallos` : ""}`
      : r.status === "duplicate"
        ? "ya destilada"
        : (r.error ?? r.status);
    log(`  ${s.sessionId.slice(0, 8)}…: ${detalle}`);
  }
  log(`Backfill: +${total.saved} nuevas, ~${total.updated} UPDATE, ⊘${total.superseded} SUPERSEDE${total.failed ? `, ${total.failed} fallos` : ""}.`);
  return { sessions: sessions.length, counters: total };
}
