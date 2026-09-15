import { createInterface } from "node:readline/promises";
import { DEFAULT_SERVER_URL, defaultServer, listCredentials, normalizeServer } from "@cortex/client";
import { getEnv, getBrandName } from "@cortex/shared";

/**
 * A qué Cortex va un comando que **no** trabaja dentro de un repositorio.
 *
 * Los que sí —los hooks, `mem`, el proxy MCP, los conectores— lo sacan del `.cortex.json` de
 * la carpeta y no preguntan nunca: esa es la decisión de ADR-0033 y preguntar ahí sería un
 * error, porque la carpeta siempre sabe y la persona puede no acordarse.
 *
 * Pero `auth login`, `auth logout` y `ui` no tienen carpeta de la que tirar. Antes cada uno
 * adivinaba a su manera, y `auth login` adivinaba mal: se iba al servidor de desarrollo por
 * defecto **ignorando el que ya tenías configurado**, así que quien tuviera dos sesiones
 * acababa autenticándose contra el que no era sin enterarse.
 *
 * El orden es: lo que se pide a mano manda, luego el entorno, luego lo evidente, y solo se
 * pregunta cuando de verdad hay ambigüedad y hay alguien delante para responder.
 */

export interface OpcionesServidor {
  /** El verbo, para que la pregunta se lea como una frase: "sign in to", "open"… */
  verbo: string;
  /** `auth login` puede ir a un servidor en el que aún no hay sesión. */
  permitirDesconocido?: boolean;
}

function argOf(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(`--${nombre}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${nombre}=`))?.split("=").slice(1).join("=");
}

/** `null` si no se puede decidir y se ha explicado por qué. */
export async function resolveServidor(args: string[], opts: OpcionesServidor): Promise<string | null> {
  const explicito = argOf(args, "server");
  if (explicito) return normalizeServer(explicito);

  // El entorno gana a lo guardado: es como un script dice "este y no otro".
  const delEntorno = getEnv("CORTEX_SERVER_URL", "").trim();
  if (delEntorno) return normalizeServer(delEntorno);

  const sesiones = listCredentials();
  if (sesiones.length === 0) return opts.permitirDesconocido ? normalizeServer(DEFAULT_SERVER_URL) : null;
  if (sesiones.length === 1) return normalizeServer(sesiones[0]!.server);

  // Varias sesiones y nadie ha dicho cuál. Adivinar aquí es lo que hacía que el conocimiento
  // de un cliente acabara en el servidor de otro, así que o se pregunta o se para.
  if (!process.stdin.isTTY) {
    console.error(`There is more than one ${getBrandName()} configured. Say which one to ${opts.verbo}:`);
    for (const c of sesiones) {
      console.error(`  --server ${c.server}${normalizeServer(c.server) === defaultServer() ? "   (default)" : ""}`);
    }
    return null;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Which ${getBrandName()} do you want to ${opts.verbo}?`);
    sesiones.forEach((c, i) => {
      const marca = normalizeServer(c.server) === defaultServer() ? "  (default)" : "";
      console.log(`  ${i + 1}) ${c.server}${marca}  —  ${c.email}`);
    });
    const respuesta = (await rl.question(`Choose 1-${sesiones.length} [1]: `)).trim();
    const n = respuesta === "" ? 1 : Number(respuesta);
    if (!Number.isInteger(n) || n < 1 || n > sesiones.length) {
      console.error("That is not one of the options.");
      return null;
    }
    return normalizeServer(sesiones[n - 1]!.server);
  } finally {
    rl.close();
  }
}
