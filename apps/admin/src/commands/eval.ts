import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, saveContext, searchContext, type ProjectRef } from "@cortex/core";
import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";

/**
 * `cortex-admin eval` — mide la recuperación contra un conjunto de preguntas con la evidencia
 * anotada.
 *
 * Existe para responder a la única pregunta que importa al tocar el troceado, el rerank o los
 * embeddings: **¿ha mejorado o ha empeorado?** Sin esto, cada cambio se defiende con ejemplos
 * elegidos a mano, que es como no defenderlo.
 *
 * El corpus va fijo en el repo (`tests/fixtures/eval/`) y no se saca de la memoria real: un
 * eval sirve para comparar ejecuciones, y la memoria real cambia todos los días, así que el
 * mismo cambio de código daría números distintos según lo que se hubiera capturado esa semana.
 *
 *   cortex-admin eval                  corpus fijo en un proyecto temporal (lo borra al salir)
 *   cortex-admin eval --keep           deja el proyecto para mirarlo por dentro
 *   cortex-admin eval --project "X"    contra un proyecto real, con tus propias preguntas
 *   cortex-admin eval --questions <f>  otro fichero de preguntas
 *   cortex-admin eval --k 10           cuántos resultados se miran (por defecto 5)
 */

interface Entrada {
  id: string;
  type: string;
  title: string;
  content: string;
}

interface Pregunta {
  id: string;
  kind: string;
  question: string;
  /** Ids del corpus que responden. Vacío = la respuesta no está: no debería salir nada bueno. */
  evidence: string[];
}

interface Resultado {
  pregunta: Pregunta;
  /** Posición (1..k) de la primera evidencia correcta, o 0 si ninguna aparece. */
  primerAcierto: number;
  encontradas: number;
  esperadas: number;
  /** Para las preguntas sin respuesta: qué puntuó lo mejor que salió. */
  mejorPuntuacion: number;
  /** Lo que salió, para poder mirar por qué falló sin volver a montar el corpus. */
  salieron: { titulo: string; tipo: string; score: number; acierto: boolean }[];
}

function flag(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(`--${nombre}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${nombre}=`))?.split("=").slice(1).join("=");
}

const RAIZ = new URL("../../../../", import.meta.url).pathname;
const DIR_FIXTURES = join(RAIZ, "tests/fixtures/eval");

function leeJson<T>(ruta: string): T {
  return JSON.parse(readFileSync(ruta, "utf8")) as T;
}

/** Carga el corpus en un proyecto nuevo y devuelve el mapa id-del-corpus → id-de-entrada. */
async function cargaCorpus(proyecto: ProjectRef, corpus: Entrada[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (const e of corpus) {
    const { entry } = await saveContext(
      { content: e.content, project: proyecto.name, title: e.title, type: e.type as never, confidence: "high" },
      { useClassifier: false, detectImprovements: false },
    );
    mapa.set(e.id, entry.id);
  }
  return mapa;
}

function tabla(filas: [string, string, string, string][]): string {
  const anchos = [0, 1, 2, 3].map((i) => Math.max(...filas.map((f) => f[i]!.length)));
  return filas
    .map((f, n) => {
      const linea = f.map((c, i) => (i === 0 ? c.padEnd(anchos[i]!) : c.padStart(anchos[i]!))).join("  ");
      return n === 0 ? `${linea}\n${anchos.map((a) => "─".repeat(a)).join("  ")}` : linea;
    })
    .join("\n");
}

export async function run(args: string[]): Promise<void> {
  const k = Number(flag(args, "k") ?? "5");
  const proyectoExistente = flag(args, "project");
  const preguntas = leeJson<Pregunta[]>(flag(args, "questions") ?? join(DIR_FIXTURES, "questions.json"));

  const proveedor = getEmbeddingProvider();
  if (proveedor.model.startsWith("local")) {
    console.warn(
      "⚠️  EMBEDDINGS_PROVIDER=local: esto es un hash de palabras, no entiende que dos frases\n" +
        "    distintas digan lo mismo. Los números de abajo no valen para comparar nada; sirven\n" +
        "    como suelo. Configura un proveedor de verdad para medir.\n",
    );
  }

  let proyecto: ProjectRef;
  let mapa: Map<string, string>;
  if (proyectoExistente) {
    const sql = getSql();
    const filas = (await sql`SELECT id, name, slug FROM entities WHERE type='project' AND name=${proyectoExistente} LIMIT 1`) as unknown as {
      id: string;
      name: string;
      slug: string;
    }[];
    if (!filas[0]) {
      console.error(`No existe el proyecto "${proyectoExistente}".`);
      process.exitCode = 1;
      return;
    }
    proyecto = filas[0] as ProjectRef;
    mapa = new Map(); // con un proyecto real, la evidencia ya viene con los ids de verdad
  } else {
    const corpus = leeJson<Entrada[]>(join(DIR_FIXTURES, "corpus.json"));
    proyecto = await createProject(`Eval ${Date.now().toString(36)}`);
    console.log(`Cargando ${corpus.length} entradas en "${proyecto.name}"…`);
    mapa = await cargaCorpus(proyecto, corpus);
  }

  const idReal = (id: string): string => mapa.get(id) ?? id;

  const resultados: Resultado[] = [];
  for (const p of preguntas) {
    const hits = await searchContext({ query: p.question, project: proyecto.name, limit: k });
    const esperadas = new Set(p.evidence.map(idReal));
    let primerAcierto = 0;
    let encontradas = 0;
    hits.forEach((h, i) => {
      if (!esperadas.has(h.entry.id)) return;
      encontradas++;
      if (primerAcierto === 0) primerAcierto = i + 1;
    });
    resultados.push({
      pregunta: p,
      primerAcierto,
      encontradas,
      esperadas: esperadas.size,
      mejorPuntuacion: hits[0]?.score ?? 0,
      salieron: hits.map((h) => ({
        titulo: h.entry.title ?? "(sin título)",
        tipo: h.entry.type,
        score: h.score,
        acierto: esperadas.has(h.entry.id),
      })),
    });
  }

  // --- Números -----------------------------------------------------------------
  // recall@k con varias evidencias: acertar UNA de tres no es acertar la pregunta, así que se
  // mide la fracción recuperada de cada una y se promedia. MRR solo sobre las que tienen
  // respuesta: para las ausentes no hay posición correcta que medir.
  const conRespuesta = resultados.filter((r) => r.esperadas > 0);
  const recall = conRespuesta.reduce((s, r) => s + r.encontradas / r.esperadas, 0) / (conRespuesta.length || 1);
  const mrr = conRespuesta.reduce((s, r) => s + (r.primerAcierto ? 1 / r.primerAcierto : 0), 0) / (conRespuesta.length || 1);

  const porTipo = new Map<string, Resultado[]>();
  for (const r of conRespuesta) porTipo.set(r.pregunta.kind, [...(porTipo.get(r.pregunta.kind) ?? []), r]);

  const filas: [string, string, string, string][] = [["tipo", "n", "recall@" + k, "MRR"]];
  for (const [tipo, rs] of [...porTipo].sort()) {
    filas.push([
      tipo,
      String(rs.length),
      (rs.reduce((s, r) => s + r.encontradas / r.esperadas, 0) / rs.length).toFixed(3),
      (rs.reduce((s, r) => s + (r.primerAcierto ? 1 / r.primerAcierto : 0), 0) / rs.length).toFixed(3),
    ]);
  }
  filas.push(["TOTAL", String(conRespuesta.length), recall.toFixed(3), mrr.toFixed(3)]);

  console.log(`\n# Eval de recuperación — ${proyecto.name}`);
  console.log(`_${preguntas.length} preguntas · embeddings: ${proveedor.model} (${proveedor.dim} dim)_\n`);
  console.log(tabla(filas));

  const fallidas = conRespuesta.filter((r) => r.encontradas < r.esperadas);
  if (fallidas.length > 0) {
    console.log(`\n## No recuperado del todo (${fallidas.length})`);
    for (const r of fallidas) {
      const donde = r.primerAcierto ? `1ª evidencia en el puesto ${r.primerAcierto}` : "ninguna evidencia en los resultados";
      console.log(`- [${r.pregunta.kind}] ${r.pregunta.question}\n  ${r.encontradas}/${r.esperadas} · ${donde}`);
      // Con --verbose, lo que SÍ salió: sin eso, un fallo no dice por dónde arreglarlo.
      if (args.includes("--verbose")) {
        for (const [i, h] of r.salieron.entries()) {
          console.log(`      ${h.acierto ? "✓" : " "} ${i + 1}. (${h.score.toFixed(3)}) ${h.tipo} · ${h.titulo}`);
        }
      }
    }
  }

  const ausentes = resultados.filter((r) => r.esperadas === 0);
  if (ausentes.length > 0) {
    console.log(`\n## Preguntas sin respuesta en el corpus (${ausentes.length})`);
    console.log("_La memoria no las sabe. Se mira qué puntúa lo mejor que sale: cuanto más alto, más fácil es que un agente se lo crea._");
    for (const r of ausentes) console.log(`- ${r.pregunta.question} → mejor puntuación ${r.mejorPuntuacion.toFixed(3)}`);
  }

  if (!proyectoExistente && !args.includes("--keep")) {
    await getSql()`DELETE FROM entities WHERE id = ${proyecto.id}`;
    console.log(`\n_Proyecto temporal borrado. Usa --keep para conservarlo._`);
  } else if (!proyectoExistente) {
    console.log(`\n_Proyecto "${proyecto.name}" conservado._`);
  }
}
