import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * El registry del toolbelt: un JSON que declara qué MCPs, skills y comandos debe tener un
 * dev. Cortex ya no reparte los suyos por aquí —van en el plugin (ADR-0032)—, así que esto
 * sirve solo para el toolbelt de una organización, que vive en SU repo.
 *
 * Se reparte configuración, nunca credenciales: cada entrada declara en `auth` qué tiene que
 * poner el dev, y las que dependan de variables sin exportar se omiten con un aviso.
 * Esquema y ejemplo en docs/toolbelt-registry.md.
 */

export interface McpDef {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  /** Variables que el MCP necesita. Sin ellas, la entrada se omite (no se inventa nada). */
  env?: string[];
  auth?: string;
  /** Agentes a los que aplica. Sin esto, a todos. */
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

/** Carga el registry de una ruta local o de una URL. Lanza con un mensaje legible. */
export async function loadRegistry(source: string): Promise<Manifest> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`no se pudo descargar el registry (HTTP ${res.status}): ${source}`);
    return normalize(await res.json());
  }
  try {
    return normalize(JSON.parse(readFileSync(resolve(source), "utf8")));
  } catch (e) {
    throw new Error(`no se pudo leer el registry ${source}: ${(e as Error).message}`);
  }
}

export function emptyManifest(): Manifest {
  return structuredClone(EMPTY);
}

/** Sustituye `{REPO}` en los args. Sin `--repo`, la entrada no se puede instalar. */
export function resolveArgs(args: string[] | undefined, repo: string | null): string[] | null {
  const out = args ?? [];
  if (!out.some((a) => a.includes("{REPO}"))) return out;
  if (!repo) return null;
  return out.map((a) => a.replaceAll("{REPO}", repo));
}

/** Variables declaradas que NO están exportadas. */
export function missingEnv(d: McpDef): string[] {
  return (d.env ?? []).filter((k) => !process.env[k]);
}
