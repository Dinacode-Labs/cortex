import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
