import { getBrandName, isDefaultBrand, markCells, MARK_GRID } from "@cortex/shared";

/**
 * Splash for `cortex` (no arguments) and `cortex version`: the Cortex mark painted with block
 * characters, and next to it the name, the version and one line on what this is.
 *
 * Rules, because hooks and agents invoke this binary too:
 * - Only on an interactive terminal (`isTTY`), never in `hook-context` or `mcp`, whose stdout is
 *   protocol. Not in CI or with `TERM=dumb` either: a log full of escapes cannot be read.
 * - Only with the default brand. If the operator has set `CORTEX_BRAND_NAME` or their own logo,
 *   the CLI does not show them the Cortex mark as if it were theirs.
 * - Colour: the centre in Cortex blue; the pieces in the terminal's own foreground. `NO_COLOR`
 *   turns everything off (https://no-color.org).
 *
 * The drawing is `MARK_GRID` (@cortex/shared), the same one the web and the favicon use. Each
 * cell is "▀" followed by a space: half a character tall and one wide, close to square, with a
 * gap to the right and below. That is what makes the grid visible — the centre is four little
 * squares — and the web's hollow pieces come out solid here, in the foreground colour.
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

/** ANSI escapes for what the terminal supports; all empty under `NO_COLOR`. */
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
 * The mark's eight lines, 16 VISIBLE columns each (8 cells × "▀ "). Padding is computed without
 * the colour escapes: otherwise the rows with blue come out one column short.
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
    // trailing gaps stay (they are part of the 16 columns), with no dangling escapes
    return out + " ".repeat(Math.max(0, 16 - visible));
  });
}

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
