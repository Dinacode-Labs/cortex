import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Contenido de un `.cortex.json` (puntero a un proyecto Cortex). */
export interface CortexLink {
  /** Slug del proyecto en Cortex (clave de vínculo preferida). */
  slug?: string;
  /** Nombre del proyecto (legacy / back-compat). */
  project?: string;
  /** Opt-out explícito: este repo NO usa Cortex. */
  ignore?: boolean;
}

/** Lee el `.cortex.json` MÁS CERCANO hacia arriba desde cwd (el más cercano manda). */
export function readCortexLink(cwd: string): CortexLink | null {
  let dir = cwd;
  for (let i = 0; i < 15; i++) {
    const f = join(dir, ".cortex.json");
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, "utf8")) as CortexLink;
      } catch {
        /* json inválido → seguir hacia arriba */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Ruta del `.cortex.json` de un directorio (sin buscar hacia arriba). */
export function cortexLinkPath(dir: string): string {
  return join(dir, ".cortex.json");
}

/** Escribe el `.cortex.json` de un directorio y devuelve la ruta escrita. */
export function writeCortexLink(dir: string, link: CortexLink): string {
  const f = cortexLinkPath(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(f, JSON.stringify(link, null, 2) + "\n");
  return f;
}
