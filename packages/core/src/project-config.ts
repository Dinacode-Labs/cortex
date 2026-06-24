import { existsSync, readFileSync } from "node:fs";
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

/** Normaliza un nombre a un slug estable (sin acentos, kebab-case). */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // quita acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "proyecto"
  );
}

/**
 * Resuelve el proyecto Cortex de un directorio buscando un `.cortex.json` hacia arriba
 * desde cwd. Es cómo un repo se "apunta" (opt-in) a un proyecto de Cortex; lo usan los
 * hooks (cwd → proyecto). **Cortex es opt-in: sin `.cortex.json`, devuelve null y no se
 * inyecta ni captura nada** (un proyecto personal queda excluido por defecto).
 *
 * El `.cortex.json` MÁS CERCANO manda (no se hereda más allá de él):
 *  - `{ "project": "<Nombre>" }` → ese proyecto (válido también en subdirs del repo).
 *  - `{ "ignore": true }`        → OPT-OUT explícito: este repo NO usa Cortex. Útil para
 *    un proyecto personal anidado dentro de un árbol que sí tiene `.cortex.json` arriba.
 *  - sin `project` ni `ignore`   → null (no es un proyecto Cortex aquí).
 */
export function resolveProjectFromCwd(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 15; i++) {
    const f = join(dir, ".cortex.json");
    if (existsSync(f)) {
      try {
        const cfg = JSON.parse(readFileSync(f, "utf8")) as { project?: string; ignore?: boolean };
        if (cfg.ignore === true) return null; // opt-out explícito: corta la resolución
        return cfg.project ? String(cfg.project) : null; // el más cercano es autoritativo
      } catch {
        /* json inválido → seguir buscando hacia arriba */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
