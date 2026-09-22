import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The toolbelt registry: a JSON declaring which MCPs, skills and commands a dev should have.
 * Cortex no longer ships its own through here -- they live in the plugin (ADR-0032) -- so this
 * serves only an organisation's toolbelt, which lives in ITS repo.
 *
 * What is distributed is configuration, never credentials: each entry declares in `auth` what
 * the dev has to set, and entries depending on unexported variables are skipped with a warning.
 * Schema and example in docs/toolbelt-registry.md.
 */

export interface McpDef {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  /** Variables the MCP needs. Without them the entry is skipped (nothing is invented). */
  env?: string[];
  auth?: string;
  /** The agents it applies to. Without this, all of them. */
  agents?: string[];
}

export interface Manifest {
  mcpServers: Record<string, McpDef>;
  skills: { name: string; auth?: string }[];
  commands: { name: string; file: string }[];
}

const EMPTY: Manifest = { mcpServers: {}, skills: [], commands: [] };

function normalize(raw: unknown): Manifest {
  const m = (raw ?? {}) as Partial<Manifest>;
  return {
    mcpServers: m.mcpServers ?? {},
    skills: Array.isArray(m.skills) ? m.skills : [],
    commands: Array.isArray(m.commands) ? m.commands : [],
  };
}

/** Loads the registry from a local path or a URL. Throws with a readable message. */
export async function loadRegistry(source: string): Promise<Manifest> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`could not download the registry (HTTP ${res.status}): ${source}`);
    return normalize(await res.json());
  }
  try {
    return normalize(JSON.parse(readFileSync(resolve(source), "utf8")));
  } catch (e) {
    throw new Error(`could not read the registry ${source}: ${(e as Error).message}`);
  }
}

export function emptyManifest(): Manifest {
  return structuredClone(EMPTY);
}

/** Substitutes `{REPO}` in the args. Without `--repo`, the entry cannot be installed. */
export function resolveArgs(args: string[] | undefined, repo: string | null): string[] | null {
  const out = args ?? [];
  if (!out.some((a) => a.includes("{REPO}"))) return out;
  if (!repo) return null;
  return out.map((a) => a.replaceAll("{REPO}", repo));
}

export function missingEnv(d: McpDef): string[] {
  return (d.env ?? []).filter((k) => !process.env[k]);
}
