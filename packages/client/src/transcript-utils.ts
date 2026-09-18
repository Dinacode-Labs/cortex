import { readFileSync } from "node:fs";
import { getEnvNum, scrub } from "@cortex/shared";

/**
 * Transcript utilities (pure / read-only) shared by distillation and the agent-session
 * capture pipeline: secret scrubbing, noise removal, per-role text extraction, condensing a
 * .jsonl into a dialogue and slicing it into windows.
 *
 * Env: CORTEX_SESSIONS_MAX_WINDOWS (default 8), CORTEX_SESSIONS_WINDOW_CHARS (default 9000),
 *      CORTEX_SESSIONS_TURN_CHARS (default 2500).
 */

const MAX_WINDOWS = getEnvNum("CORTEX_SESSIONS_MAX_WINDOWS", 8);
const WINDOW_CHARS = getEnvNum("CORTEX_SESSIONS_WINDOW_CHARS", 9000);
const TURN_CHARS = getEnvNum("CORTEX_SESSIONS_TURN_CHARS", 2500);

// `scrub` lives in @cortex/shared (core also uses it when persisting, and so do the
// connectors). It is re-exported here because this module is the historical entry point for
// the distillation layer and the tests.
export { scrub } from "@cortex/shared";

function clean(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, "")
    .replace(/<local-command-[a-z-]+>[\s\S]*?<\/local-command-[a-z-]+>/g, "")
    .trim();
}

interface Block { type?: string; text?: string }
function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Block[]).filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n");
  }
  return "";
}
function assistantText(content: unknown): string {
  if (Array.isArray(content)) {
    return (content as Block[]).filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n");
  }
  return "";
}

/** Reads a session .jsonl -> condensed dialogue (USER/ASSISTANT), free of noise and secrets. */
export function condenseSession(file: string): string {
  const turns: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o: { type?: string; message?: { role?: string; content?: unknown } };
    try { o = JSON.parse(line); } catch { continue; }
    const role = o.message?.role;
    if (o.type === "user" && role === "user") {
      const t = clean(userText(o.message?.content));
      if (t) turns.push(`USER: ${t.slice(0, TURN_CHARS)}`);
    } else if (o.type === "assistant" && role === "assistant") {
      const t = clean(assistantText(o.message?.content));
      if (t) turns.push(`ASSISTANT: ${t.slice(0, TURN_CHARS)}`);
    }
  }
  return scrub(turns.join("\n\n"));
}

export interface SlicedTranscript {
  windows: string[];
  /** Characters of the session that were NOT distilled. 0 when it all fitted. */
  dropped: number;
}

/**
 * Slices the dialogue into windows (~WINDOW_CHARS) and keeps MAX_WINDOWS of them.
 *
 * The cap exists because every window is a model call, and a long session with the cap
 * removed is twenty of them. What was wrong was not the cap: it was **which** windows
 * survived, and that nobody was told.
 *
 * - **Which.** It used to cut off on reaching the cap, so out of a 128,000-character session
 *   the first 72,000 were distilled and the rest thrown away. In a working session the
 *   conclusions are at the end: what got discarded was exactly what had to be remembered.
 *   Now, when it does not fit whole, the windows are spread across the entire session --
 *   first and last always included -- so the start, the middle and the close all arrive.
 * - **That nobody was told.** The capture ended as `done` with its counters, identical to one
 *   that did fit. Now how much was left out is returned, and the server stores it.
 */
export function windows(text: string): string[] {
  return sliceTranscript(text).windows;
}

export function sliceTranscript(text: string): SlicedTranscript {
  const all: string[] = [];
  let buf = "";
  for (const turn of text.split("\n\n")) {
    if (buf.length + turn.length > WINDOW_CHARS && buf) {
      all.push(buf);
      buf = "";
    }
    buf += (buf ? "\n\n" : "") + turn;
  }
  if (buf) all.push(buf);
  if (all.length <= MAX_WINDOWS) return { windows: all, dropped: 0 };

  // Even spread that keeps the extremes: the first index is 0 and the last is the last one.
  const step = (all.length - 1) / (MAX_WINDOWS - 1);
  const picked = Array.from({ length: MAX_WINDOWS }, (_, i) => Math.round(i * step));
  const unique = [...new Set(picked)];
  const chosen = unique.map((i) => all[i]!);
  const dropped = all.reduce((n, w, i) => (unique.includes(i) ? n : n + w.length), 0);
  return { windows: chosen, dropped };
}
