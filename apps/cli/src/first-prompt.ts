import { closeSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstPromptLookup } from "@cortex/shared";
import { readCortexLink } from "@cortex/client";

export interface FirstPromptInput {
  sessionId?: string;
  cwd: string;
  /** Codex has every MCP tool loaded already, so the order skips loading them. */
  codex?: boolean;
  stateDir?: string;
}

const markerName = (sessionId: string): string => `cortex-first-prompt-${sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128)}`;

/** `wx` creates or fails in one system call: two prompts racing each other cannot both win. */
export function claimFirstPrompt(sessionId: string, stateDir: string = tmpdir()): boolean {
  try {
    closeSync(openSync(join(stateDir, markerName(sessionId)), "wx"));
    return true;
  } catch {
    return false;
  }
}

export function firstPromptContext(input: FirstPromptInput): string | null {
  // Without a session id every prompt looks like the first, and an order repeated on each one is
  // worse than none.
  if (!input.sessionId) return null;
  const link = readCortexLink(input.cwd);
  if (!link || link.ignore || !link.slug) return null;
  if (!claimFirstPrompt(input.sessionId, input.stateDir)) return null;
  return firstPromptLookup({ toolSearch: !input.codex });
}
