import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { apiPost } from "@cortex/shared";
import { condenseSession, scrub, windows } from "./transcript-utils.js";
import { distill, type Item } from "./distill.js";
import { readSessions } from "./session-readers.js";

/**
 * Backfill de conversaciones de agente → Cortex, DEPURADAS (roadmap). Lee las sesiones
 * de un agente en un proyecto, extrae el diálogo útil (descartando tool calls, volcados
 * y thinking), borra secretos, y **destila con LLM** a conocimiento TIPADO
 * (decisiones/restricciones/incidencias/convenciones…), que guarda con proveniencia.
 * NO ingiere el transcript crudo. Complementa a los hooks (esto es batch/retroactivo).
 *
 * v1: plataforma Claude Code (~/.claude/projects/<ruta-saneada>/*.jsonl).
 * Uso: tsx src/connect-sessions.ts "<Proyecto>" <ruta-repo> [claude]
 * Env: CORTEX_SESSIONS_LIMIT (nº sesiones).
 */

export interface ApiCaptureResult { saved: number; updated: number; superseded: number; noop: number; failed: number }

/** Pipeline compartido: dado el transcript YA CONDENSADO de una sesión (de cualquier
 * agente), distila en local y POSTea cada unidad por la API autenticada (`POST /capture`)
 * → atribución (created_by=email) + permisos en el servidor. */
export async function captureCondensedViaApi(slug: string, condensed: string, sessionId: string, platform: string, sourceType = "agent_session"): Promise<ApiCaptureResult> {
  const res: ApiCaptureResult = { saved: 0, updated: 0, superseded: 0, noop: 0, failed: 0 };
  if (condensed.length < 200) return res;
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const w of windows(condensed)) {
    for (const it of await distill(slug, w)) {
      const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (key.length < 3 || seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  }
  for (const it of items) {
    const r = await apiPost<{ action?: string }>("/capture", {
      slug,
      title: it.title,
      content: scrub(`${it.title}\n\n${it.content}`),
      type: it.type,
      sourceType,
      sourceReference: `${platform}:${sessionId}`,
      confidence: "low",
      metadata: { platform, sessionId },
    });
    if (!r.ok) {
      res.failed++;
      continue;
    }
    const a = r.data.action;
    if (a === "add") res.saved++;
    else if (a === "update") res.updated++;
    else if (a === "supersede" || a === "contradict") res.superseded++;
    else res.noop++;
  }
  return res;
}

/** Auto-captura del hook (Claude): lee el transcript .jsonl, lo condensa y lo captura. */
export async function captureSessionViaApi(slug: string, file: string, platform = "claude"): Promise<ApiCaptureResult> {
  const sessionId = file.split("/").pop()!.replace(/\.jsonl$/, "");
  return captureCondensedViaApi(slug, condenseSession(file), sessionId, platform);
}

/** Backfill de sesiones de un repo → proyecto (lo invoca `cortex connect-sessions`). */
export async function runSessionsBackfill(slug: string, repoPath: string, platform: string): Promise<void> {

  const limit = process.env.CORTEX_SESSIONS_LIMIT ? Number(process.env.CORTEX_SESSIONS_LIMIT) : undefined;

  // Cada sesión → { sessionId, condensed }. Claude lee transcripts .jsonl; el resto, su store.
  let sessions: { sessionId: string; condensed: string }[];
  if (platform === "claude") {
    const folder = join(homedir(), ".claude/projects", repoPath.replace(/[^a-zA-Z0-9]/g, "-"));
    if (!existsSync(folder)) {
      console.error(`No hay sesiones de Claude para ${repoPath} (${folder} no existe).`);
      process.exitCode = 1;
      return;
    }
    let files = readdirSync(folder).filter((f) => f.endsWith(".jsonl")).map((f) => join(folder, f));
    files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (limit) files = files.slice(0, limit);
    sessions = files.map((f) => ({ sessionId: f.split("/").pop()!.replace(/\.jsonl$/, ""), condensed: condenseSession(f) }));
  } else {
    sessions = await readSessions(platform, repoPath);
    if (limit) sessions = sessions.slice(0, limit);
  }
  console.log(`${sessions.length} sesiones (${platform}) para ${repoPath}. Destilando → "${slug}" (vía API)...`);

  let savedTotal = 0;
  let updatedTotal = 0;
  let supersededTotal = 0;
  let failedTotal = 0;
  for (const s of sessions) {
    const r = await captureCondensedViaApi(slug, s.condensed, s.sessionId, platform);
    savedTotal += r.saved;
    updatedTotal += r.updated;
    supersededTotal += r.superseded;
    failedTotal += r.failed;
    console.log(`  ${s.sessionId.slice(0, 8)}…: +${r.saved} nuevas, ~${r.updated} fusionadas, ⊘${r.superseded} superadas${r.failed ? `, ${r.failed} fallos` : ""}`);
  }
  console.log(`Backfill: +${savedTotal} nuevas, ~${updatedTotal} UPDATE, ⊘${supersededTotal} SUPERSEDE${failedTotal ? `, ${failedTotal} fallos (¿cortex auth login / servidor?)` : ""}.`);
}
