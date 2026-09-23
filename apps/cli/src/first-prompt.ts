import { closeSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstPromptLookup } from "@cortex/shared";
import { readCortexLink } from "@cortex/client";

export interface FirstPromptInput {
  sessionId?: string;
  cwd: string;
  /** Codex has every MCP tool loaded already, so the order skips loading them. Default: false. */
  codex?: boolean;
  /** Where the "already asked" markers live. Default: `os.tmpdir()`. */
  stateDir?: string;
}

const markerName = (sessionId: string): string => `cortex-first-prompt-${sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128)}`;

/**
 * True exactly once per session. `wx` creates the marker or fails if it is there, in one system
 * call: two prompts racing each other cannot both win, and every later prompt costs one `open`.
 */
export function claimFirstPrompt(sessionId: string, stateDir: string = tmpdir()): boolean {
  try {
    closeSync(openSync(join(stateDir, markerName(sessionId)), "wx"));
    return true;
  } catch {
    return false;
  }
}

/**
 * The order to inject on a prompt, or null when there is nothing to say. With no session id there
 * is no way to tell the first prompt from the rest, and repeating the order on every one is worse
 * than not giving it.
 */
export function firstPromptContext(input: FirstPromptInput): string | null {
  if (!input.sessionId) return null;
  const link = readCortexLink(input.cwd);
  if (!link || link.ignore || !link.slug) return null;
  if (!claimFirstPrompt(input.sessionId, input.stateDir)) return null;
  return firstPromptLookup({ toolSearch: !input.codex });
}
