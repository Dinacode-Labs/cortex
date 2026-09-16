import { getBrandName, type ContextEntry } from "@cortex/shared";
import type { ContextPack } from "./context-pack.js";
import type { SaveContextResult } from "./save.js";
import type { SearchHit } from "./vectors.js";

/**
 * Renderizadores a Markdown: es lo que devuelven las tools MCP y lo que el hook inyecta al
 * abrir sesión. Va en INGLÉS porque lo lee un modelo que puede estar trabajando en cualquier
 * idioma, y porque a menudo lo repite tal cual al usuario. El CONTENIDO de cada entrada
 * conserva el idioma en que se escribió; lo que se traduce es el andamiaje.
 */

function entryLine(e: ContextEntry): string {
  const ref = e.sourceReference ? ` · source: ${e.sourceReference}` : "";
  return `- **${e.title}** _(confidence: ${e.confidence}, status: ${e.status})_\n  ${e.summary ?? e.content}${ref}`;
}

export function renderSaveResult(result: SaveContextResult): string {
  const { entry, warnings } = result;
  const lines = [
    `✅ Saved to ${getBrandName()} as **${entry.type}** (id: \`${entry.id}\`).`,
    `Title: ${entry.title}`,
    `Status: ${entry.status} · Confidence: ${entry.confidence}`,
  ];
  if (warnings.length > 0) {
    lines.push("", "⚠️ Things worth looking at:");
    for (const w of warnings) lines.push(`- ${w.message}`);
  }
  return lines.join("\n");
}

export function renderSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return `Nothing relevant in ${getBrandName()}.`;
  return hits
    .map((h, i) => `${i + 1}. (${h.score.toFixed(2)}) ${entryLine(h.entry)}`)
    .join("\n");
}

export function renderDecisions(entries: ContextEntry[]): string {
  if (entries.length === 0) return "No decisions recorded for this project yet.";
  return entries.map(entryLine).join("\n");
}

interface Seccion {
  titulo: string;
  bloques: string[];
  /** Cuánto presupuesto le toca respecto a las demás. Ver `PACK_SECTIONS`. */
  peso: number;
}

function nota(n: number): string {
  return `- _…and ${n} more here. Ask ${getBrandName()} for the rest._`;
}

/**
 * Escribe una sección con sus `n` primeras entradas, diciendo cuántas se ha dejado.
 *
 * Cuando no cabe ninguna va igualmente el título y la cuenta: que el agente sepa que este
 * proyecto tiene restricciones apuntadas vale mucho más que no mencionarlas, porque una
 * sección ausente se lee como «aquí no hay nada».
 */
function escribe(s: Seccion, n: number): string {
  const fuera = s.bloques.length - n;
  const cuerpo = [...s.bloques.slice(0, n), ...(fuera > 0 ? [nota(fuera)] : [])];
  return `\n## ${s.titulo}\n${cuerpo.join("\n")}`;
}

/**
 * Reparte un presupuesto entre secciones que piden cantidades distintas, sin que las grandes
 * ahoguen a las pequeñas: cada una recibe según su peso, y lo que una no gasta vuelve al bote
 * para las demás (llenado por niveles). Devuelve cuánto le corresponde a cada una.
 *
 * El peso existe porque no todo el conocimiento vale lo mismo cuando hay que elegir: una
 * decisión en vigor gobierna lo que el agente va a hacer ahora, y una incidencia de hace tres
 * meses lo acompaña. Sin pesos, repartir entre once secciones dejaba a las decisiones con lo
 * mismo que a los how-to.
 */
function reparte(costes: number[], pesos: number[], presupuesto: number): number[] {
  const asignado = new Array<number>(costes.length).fill(0);
  let pendientes = costes.map((_, i) => i);
  let bote = presupuesto;
  while (pendientes.length > 0 && bote > 0) {
    const pesoTotal = pendientes.reduce((a, i) => a + pesos[i]!, 0);
    if (pesoTotal <= 0) break;
    const porPeso = bote / pesoTotal;
    if (porPeso < 1) break;
    const satisfechos = pendientes.filter((i) => costes[i]! <= porPeso * pesos[i]!);
    if (satisfechos.length === 0) {
      // Nadie cabe entero: cada una se queda con su parte proporcional y aquí se acaba.
      for (const i of pendientes) asignado[i] = Math.floor(porPeso * pesos[i]!);
      return asignado;
    }
    for (const i of satisfechos) {
      asignado[i] = costes[i]!;
      bote -= costes[i]!;
    }
    pendientes = pendientes.filter((i) => costes[i]! > porPeso * pesos[i]!);
  }
  return asignado;
}

/** Cuántas entradas de la sección caben en lo que le ha tocado. */
function cuantasCaben(s: Seccion, presupuesto: number): number {
  let n = 0;
  while (n < s.bloques.length && escribe(s, n + 1).length <= presupuesto) n++;
  return n;
}

export interface RenderPackOptions {
  /**
   * Tope de caracteres. Sin él, el pack sale entero.
   *
   * Existe porque el hook cortaba el pack con un `slice()` al final: con un proyecto de
   * doscientas entradas, al agente le llegaban las decisiones y **nada más** —las
   * restricciones, los riesgos y la deuda se quedaban fuera de la tijera sin que nadie se
   * enterara—. Un corte ciego no es un resumen: es perder justo lo que no cupo por orden
   * alfabético del andamiaje. Con tope, cada sección recibe su parte y lo que una no gasta
   * vuelve al bote, así que siempre llega algo de cada tipo de conocimiento.
   */
  maxChars?: number;
}

export function renderContextPack(pack: ContextPack, opts: RenderPackOptions = {}): string {
  // Aviso pegado a CADA entrada implicada, no en una sección aparte: si va al final, el
  // agente ya se ha creído la entrada cuando llega el aviso.
  const avisos = new Map<string, string>();
  for (const c of pack.conflicts ?? []) {
    const lineas: string[] = [];
    if (c.entries.length > 0) {
      const con = c.entries.map((e) => `"${e.label}" (recorded ${e.recordedLater ? "later" : "earlier"})`).join(", ");
      lineas.push(`  ⚠️ Conflicts with ${con}. Both are still recorded as current: check which one holds before relying on this.`);
    }
    for (const a of c.areas) {
      lineas.push(`  ⚠️ Touches "${a.entity}", which is recorded as contradicting ${a.against.map((x) => `"${x}"`).join(", ")}. That corner is disputed: check it before relying on this.`);
    }
    if (lineas.length > 0) avisos.set(c.entryId, lineas.join("\n"));
  }
  const linea = (e: ContextEntry): string => {
    const aviso = avisos.get(e.id);
    return aviso ? `${entryLine(e)}\n${aviso}` : entryLine(e);
  };

  const secciones: Seccion[] = [
    ...pack.sections.map((s) => ({ titulo: s.titulo, peso: s.peso, bloques: s.entries.map(linea) })),
    { titulo: "Sensitive modules", peso: 1, bloques: pack.sensitiveModules.map((m) => `- ${m}`) },
    {
      titulo: "Most relevant to the area you asked about",
      // Lo que se ha pedido a mano pesa: alguien ha dicho explícitamente por dónde anda.
      peso: 3,
      bloques: pack.relevantToArea.map((h) => `- (${h.score.toFixed(2)}) ${h.entry.title} — ${h.entry.summary ?? ""}`),
    },
  ].filter((s) => s.bloques.length > 0);

  const encabezado = [
    `# Context Pack — ${pack.project}`,
    `_${pack.totalEntries} ${pack.totalEntries === 1 ? "entry" : "entries"} in total · generated ${pack.generatedAt.toISOString()}_`,
  ].join("\n");

  const junta = (piezas: string[]) => [encabezado, ...piezas].join("\n");
  const tope = opts.maxChars;
  if (!tope || tope <= 0) return junta(secciones.map((s) => escribe(s, s.bloques.length)));

  // Reparto inicial a partes iguales: garantiza que de CADA tipo de conocimiento llegue algo.
  const partes = reparte(
    secciones.map((s) => escribe(s, s.bloques.length).length),
    secciones.map((s) => s.peso),
    Math.max(tope - encabezado.length - secciones.length, 0),
  );
  const cuantas = secciones.map((s, i) => cuantasCaben(s, partes[i]!));

  // Y luego se comprueba contra el tope de verdad, no contra la aritmética del reparto: se
  // encoge por la cola si nos hemos pasado y se crece por la cabeza con lo que sobre. El
  // orden de `secciones` es el de importancia para quien lo va a leer.
  const cabe = () => junta(secciones.map((s, i) => escribe(s, cuantas[i]!))).length <= tope;
  for (let i = secciones.length - 1; i >= 0 && !cabe(); i--) {
    while (cuantas[i]! > 0 && !cabe()) cuantas[i] = cuantas[i]! - 1;
  }
  for (let vuelta = 0; vuelta < secciones.length; vuelta++) {
    let movido = false;
    for (let i = 0; i < secciones.length; i++) {
      while (cuantas[i]! < secciones[i]!.bloques.length) {
        cuantas[i] = cuantas[i]! + 1;
        if (cabe()) movido = true;
        else {
          cuantas[i] = cuantas[i]! - 1;
          break;
        }
      }
    }
    if (!movido) break;
  }
  return junta(secciones.map((s, i) => escribe(s, cuantas[i]!)));
}
