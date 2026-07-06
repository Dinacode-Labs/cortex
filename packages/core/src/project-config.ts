import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalize } from "./text.js";

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

/** Normaliza un nombre a un slug estable (sin acentos, kebab-case). */
export function slugify(name: string): string {
  // Reutiliza la normalizaci\u00f3n can\u00f3nica base (NFD + sin diacr\u00edticos + min\u00fasculas
  // + trim + colapsa espacios) y la lleva a kebab-case acotado a 60 caracteres.
  return (
    canonicalize(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "proyecto"
  );
}
