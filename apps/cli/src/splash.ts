import { getBrandName, isDefaultBrand, markCells, MARK_GRID } from "@cortex/shared";

/**
 * Splash de `cortex` (sin argumentos) y de `cortex version`: el sello de Cortex pintado con
 * caracteres de bloque, y al lado el nombre, la versión y una línea de qué es esto.
 *
 * Reglas, porque este binario también lo invocan hooks y agentes:
 * - Solo en un terminal interactivo (`isTTY`), nunca en `hook-context` ni `mcp`, que hablan
 *   protocolo por stdout. En CI o con `TERM=dumb` tampoco: un log con cursores no se lee.
 * - Solo con la marca por defecto. Si el operador ha puesto `CORTEX_BRAND_NAME` o su logo, el
 *   CLI no le enseña el sello de Cortex como si fuera suyo.
 * - Color: el centro en el azul de Cortex; las piezas, en el color del terminal. `NO_COLOR`
 *   lo apaga todo (https://no-color.org).
 *
 * El dibujo sale de `MARK_GRID` (@cortex/shared), el mismo que la web y el favicon. Cada
 * celda es «▀» seguido de un espacio: medio carácter de alto y uno de ancho, casi cuadrado,
 * con hueco a la derecha y abajo. Así se ve la rejilla —el centro son cuatro cuadraditos— y
 * las piezas huecas de la web quedan aquí sólidas en el color de primer plano.
 */
export interface SplashEnv {
  env?: NodeJS.ProcessEnv;
  tty?: boolean;
}

export function wantsSplash(opts: SplashEnv = {}): boolean {
  const env = opts.env ?? process.env;
  const tty = opts.tty ?? process.stdout.isTTY === true;
  return tty && !env.CI && env.TERM !== "dumb" && isDefaultBrand();
}

type Paint = { accent: string; dim: string; bold: string; reset: string };

/** Escapes ANSI según lo que soporte el terminal; todo vacío con `NO_COLOR`. */
export function paint(env: NodeJS.ProcessEnv = process.env): Paint {
  if (env.NO_COLOR !== undefined) return { accent: "", dim: "", bold: "", reset: "" };
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM ?? "");
  return {
    accent: truecolor ? "\x1b[38;2;26;109;255m" : "\x1b[38;5;33m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    reset: "\x1b[0m",
  };
}

/**
 * Las ocho líneas del sello, de 16 columnas VISIBLES cada una (8 celdas × «▀ »). El relleno se
 * calcula sin los escapes de color: si no, las filas con azul quedan una columna más cortas.
 */
export function renderMark(p: Paint): string[] {
  const parts = new Map(markCells().map((c) => [`${c.x},${c.y}`, c.part]));
  return MARK_GRID.map((row, y) => {
    let visible = 0;
    let out = "";
    [...row].forEach((ch, x) => {
      if (ch !== "X") {
        out += "  ";
        visible += 2;
        return;
      }
      const core = parts.get(`${x},${y}`) === "core";
      out += core ? `${p.accent}▀${p.reset} ` : "▀ ";
      visible += 2;
    });
    // los huecos del final se dejan (son parte de las 16 columnas), pero sin escapes sueltos
    return out + " ".repeat(Math.max(0, 16 - visible));
  });
}

/** Sello + columna de texto, como líneas listas para imprimir. */
export function splashLines(version: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const p = paint(env);
  const right: string[] = [
    `${p.bold}${getBrandName()}${p.reset}`,
    `${p.dim}v${version}${p.reset}`,
    "",
    "Project memory for coding agents.",
    `${p.dim}maintained by Dinacode Labs${p.reset}`,
    "",
    `${p.dim}Run \`cortex --help\` to see the commands.${p.reset}`,
    "",
  ];
  const mark = renderMark(p);
  return ["", ...mark.map((line, i) => `  ${line}    ${right[i] ?? ""}`.replace(/\s+$/, "")), ""];
}

export function printSplash(version: string): void {
  for (const line of splashLines(version)) console.log(line);
}
