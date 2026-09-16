import { scrub, type CaptureSessionCounters, type SourceType } from "@cortex/shared";
import { trocea } from "@cortex/client";
import { saveWithReconciliation } from "@cortex/core";
import { distill } from "./distill.js";

/**
 * Destilación de una sesión de agente **en el servidor** (ADR-0025).
 *
 * Antes esto corría en el portátil de cada dev: el hook leía el transcript, llamaba al
 * modelo con la clave del `.env` del repo clonado y luego posteaba cada pieza por HTTP. Eso
 * obligaba a repartir credenciales de LLM a todo el equipo y ponía N clientes a pegarle al
 * proveedor en paralelo. Ahora el cliente solo manda el transcript condensado y el servidor
 * —que ya tiene las credenciales y controla la concurrencia— hace el trabajo caro.
 *
 * Al estar dentro del servidor, guarda con `saveWithReconciliation` directamente en vez de
 * dar un rodeo por la API.
 */

export interface DistillSessionInput {
  /** Nombre del proyecto (lo que espera `saveContext`). */
  projectName: string;
  /** Transcript ya condensado. Se vuelve a escrubar aquí: no se confía en el cliente. */
  condensed: string;
  platform: string;
  sessionId: string;
  /** Email autenticado: es la atribución de todo lo que salga de esta sesión. */
  createdBy: string;
  sourceType?: SourceType;
}

export type DistillSessionFn = (input: DistillSessionInput) => Promise<CaptureSessionCounters>;

/** Por debajo de esto no hay conversación de la que sacar nada útil. */
const MIN_CHARS = 200;

export const distillSession: DistillSessionFn = async (input) => {
  const counters: CaptureSessionCounters = { saved: 0, updated: 0, superseded: 0, noop: 0, failed: 0, windows: 0 };
  // Última línea de defensa: el cliente escruba, pero la API la puede llamar cualquiera.
  const condensed = scrub(input.condensed);
  if (condensed.length < MIN_CHARS) return counters;

  const sourceType = input.sourceType ?? "agent_session";
  const sourceReference = `${input.platform}:${input.sessionId}`;
  const seen = new Set<string>();

  const { ventanas, descartados } = trocea(condensed);
  if (descartados > 0) {
    // Que se note: una sesión recortada terminaba en `done` igual que una que cupo entera.
    counters.droppedChars = descartados;
    console.warn(
      `[session-distill] ${sourceReference}: ${descartados} caracteres fuera del destilado ` +
        `(${ventanas.length} ventanas repartidas a lo largo de la sesión). ` +
        `Sube CORTEX_SESSIONS_MAX_WINDOWS si quieres cubrirla entera.`,
    );
  }

  for (const window of ventanas) {
    counters.windows++;
    let items: Awaited<ReturnType<typeof distill>>;
    try {
      items = await distill(input.projectName, window);
    } catch (e) {
      // Una ventana que falla (timeout, 429 tras los reintentos) no debe tirar la sesión
      // entera: se cuenta y se sigue con las demás.
      counters.failed++;
      console.error(`[session-distill] ventana fallida (${sourceReference}):`, (e as Error).message);
      continue;
    }

    for (const item of items) {
      // Dedup barato dentro de la propia sesión: el mismo tema suele repetirse entre
      // ventanas y no tiene sentido pagar la reconciliación para descubrirlo.
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (key.length < 3 || seen.has(key)) continue;
      seen.add(key);

      try {
        const res = await saveWithReconciliation(
          {
            content: scrub(`${item.title}\n\n${item.content}`),
            project: input.projectName,
            title: item.title,
            type: item.type,
            confidence: "low", // lo destilado nace con poca confianza; `maintain` la sube si se corrobora
            sourceType,
            sourceReference,
            createdBy: input.createdBy,
            metadata: { platform: input.platform, sessionId: input.sessionId },
          } as never,
          { useClassifier: false, detectImprovements: false },
        );
        if (res.action === "add") counters.saved++;
        else if (res.action === "update") counters.updated++;
        else if (res.action === "supersede" || res.action === "contradict") counters.superseded++;
        else counters.noop++;
      } catch (e) {
        counters.failed++;
        console.error(`[session-distill] fallo al guardar "${item.title}":`, (e as Error).message);
      }
    }
  }

  return counters;
};
