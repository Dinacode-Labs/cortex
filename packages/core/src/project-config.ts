import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resuelve el proyecto Cortex asociado a un directorio buscando un `.cortex.json`
 * (`{ "project": "<Nombre>" }`) hacia arriba desde cwd. Es cómo un repo se "apunta" a
 * un proyecto de Cortex (lo usan los hooks: cwd → proyecto). Devuelve null si no hay.
 */
export function resolveProjectFromCwd(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 15; i++) {
    const f = join(dir, ".cortex.json");
    if (existsSync(f)) {
      try {
        const cfg = JSON.parse(readFileSync(f, "utf8")) as { project?: string };
        if (cfg.project) return String(cfg.project);
      } catch {
        /* json inválido */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
