import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setActiveServer } from "./api-client.js";

/** Contenido de un `.cortex.json` (puntero a un proyecto Cortex). */
export interface CortexLink {
  /** Slug del proyecto en Cortex (clave de vínculo preferida). */
  slug?: string;
  /** Nombre del proyecto (legacy / back-compat). */
  project?: string;
  /** Opt-out explícito: este repo NO usa Cortex. */
  ignore?: boolean;
  /**
   * A qué servidor pertenece este repo. Ausente = el de por defecto, que es el caso de casi
   * todo el mundo.
   *
   * El servidor es propiedad del REPO y no un modo global que se enciende y se apaga
   * (ADR-0033). Quien trabaja para varias organizaciones no tiene que acordarse de en cuál
   * está: lo decidió al vincular la carpeta.
   */
  server?: string;
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

/**
 * Resuelve el vínculo del repo y deja el proceso hablando con SU servidor.
 *
 * Lo llaman los hooks y los comandos que operan sobre una carpeta, antes de tocar la API.
 * Es lo que garantiza que la captura de un repo nunca acabe en el servidor de otro: quien
 * escribe siempre conoce el `cwd`, y el `cwd` conoce su servidor.
 */
export function useProjectServer(cwd: string): CortexLink | null {
  const link = readCortexLink(cwd);
  setActiveServer(link?.server ?? null);
  return link;
}
