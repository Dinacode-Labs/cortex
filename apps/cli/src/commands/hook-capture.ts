import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  condenseSession,
  latestCodexRollout,
  readCortexLink,
  readSessionByRef,
  sendCondensedSession,
  type CaptureAgent,
} from "@cortex/client";

/**
 * Hook de AUTO-CAPTURA (fin de sesión, y pre-compactación). Resuelve el proyecto por el
 * `.cortex.json` del repo, saca el diálogo de la sesión que acaba de terminar —quitando tool
 * calls, volcados y secretos— y lo manda al servidor, que es quien lo destila a conocimiento
 * tipado (ADR-0025). Aquí no hay ni LLM ni base de datos: solo la sesión de `cortex auth login`.
 *
 * Cada agente cuenta la sesión a su manera. Claude y Codex pasan la ruta del transcript;
 * OpenCode y Hermes, un id; Pi, la ruta de su fichero de sesión. Por eso hay tres formas de
 * decirle cuál es: `--session`, el JSON del stdin, o —último recurso, Codex— la sesión más
 * reciente de este repo.
 *
 * Silencioso por diseño: un hook corre dentro de la sesión de un agente y nunca debe
 * romperla. Ver docs/research/hooks-integration.md.
 *
 *   cortex hook-capture [--platform claude|codex|opencode|hermes|pi] [--session <id|ruta>] [--cwd <dir>]
 */

const PLATFORMS: CaptureAgent[] = ["claude", "codex", "opencode", "hermes", "pi"];

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

/**
 * De dónde sale el agente cuando nadie lo dice: de la propia ruta del transcript. El plugin
 * lo comparten Claude Code y Codex, así que el hook no puede llevarlo cableado.
 */
export function detectPlatform(transcript: string | undefined): CaptureAgent {
  if (transcript?.includes("/.codex/")) return "codex";
  if (transcript?.includes("/.pi/")) return "pi";
  return "claude";
}

export async function run(args: string[] = []): Promise<void> {
  try {
    let input: { cwd?: string; session_id?: string; sessionId?: string; transcript_path?: string } = {};
    try {
      input = JSON.parse((await readStdin()) || "{}");
    } catch {
      input = {};
    }

    const cwd = flag(args, "cwd") || input.cwd || process.cwd();
    const link = readCortexLink(cwd);
    if (!link || link.ignore || !link.slug) return; // sin vínculo por slug (usa `cortex link`)

    const asked = flag(args, "platform") as CaptureAgent | undefined;
    if (asked && !PLATFORMS.includes(asked)) return;
    const transcript = flag(args, "session") || input.transcript_path;
    const platform: CaptureAgent = asked ?? detectPlatform(transcript);
    const sessionId = input.session_id || input.sessionId;

    let condensed: string;
    let id: string;

    if (platform === "claude") {
      // El transcript de Claude conserva más señal que el store, así que se lee tal cual.
      if (!transcript || !existsSync(transcript)) return;
      condensed = condenseSession(transcript);
      id = sessionId || basename(transcript).replace(/\.jsonl$/, "");
    } else {
      // Codex a veces no da ni ruta ni id (según el evento): entonces, la sesión más
      // reciente de ESTE repo. Es la que acaba de cerrarse.
      const ref = transcript || sessionId || (platform === "codex" ? latestCodexRollout(cwd) : null);
      if (!ref) return;
      const session = await readSessionByRef(platform, ref);
      if (!session) return;
      condensed = session.condensed;
      id = session.sessionId;
    }

    if (!condensed.trim()) return;

    // No se espera al resultado: destilar tarda y el hook tiene un timeout corto. El
    // servidor encola el trabajo y responde 202.
    const r = await sendCondensedSession({ slug: link.slug, condensed, sessionId: id, platform });
    if (r.status === "failed") {
      console.error(`[cortex hook] no se pudo capturar "${link.slug}": ${r.error ?? "error"} (¿cortex auth login / servidor?)`);
    } else if (r.status !== "duplicate") {
      console.error(`[cortex hook] sesión de ${platform} enviada a "${link.slug}" (el servidor la destila).`);
    }
  } catch {
    /* silencioso: un hook no debe romper la sesión */
  } finally {
    process.exit(0);
  }
}
