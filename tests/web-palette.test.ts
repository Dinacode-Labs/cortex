import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Dark mode is the light palette redefined (ADR-0092). A token forgotten in the dark palette stays
 * light on a dark page, and a colour written outside it -- every badge's inline `style` -- never changes.
 */
const WEB = resolve(import.meta.dirname, "../apps/web");
const CSS = readFileSync(resolve(WEB, "public/styles.css"), "utf8");
const DARK_QUERY = "@media (prefers-color-scheme:dark)";
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|color-mix\(/;

function blockAt(css: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return { body: css.slice(open + 1, i), end: i + 1 };
  }
  throw new Error("unbalanced braces in styles.css");
}

const tokensIn = (body: string): Map<string, string> =>
  new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

const darkStart = CSS.indexOf(DARK_QUERY);
const dark = darkStart >= 0 ? blockAt(CSS, CSS.indexOf("{", darkStart)) : null;
const lightRootStart = CSS.indexOf(":root");
const lightRoot = blockAt(CSS, CSS.indexOf("{", lightRootStart));

describe("the web UI's palette (ADR-0092)", () => {
  it("there is a dark palette", () => {
    expect(dark).not.toBeNull();
  });

  it("every colour token of the light palette has its dark value", () => {
    const lightColours = [...tokensIn(lightRoot.body)].filter(([, value]) => COLOUR.test(value)).map(([name]) => name);
    const darkTokens = tokensIn(dark!.body);
    expect(lightColours.length).toBeGreaterThan(20);
    expect(lightColours.filter((name) => !darkTokens.has(name))).toEqual([]);
  });

  it("the dark palette only redefines tokens the light one declares", () => {
    const light = tokensIn(lightRoot.body);
    expect([...tokensIn(dark!.body).keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  it("no rule outside the palette writes a colour of its own", () => {
    const rules = CSS.slice(0, lightRootStart) + CSS.slice(lightRoot.end, darkStart) + CSS.slice(dark!.end);
    const offenders = rules
      .split("\n")
      .map((line, i) => ({ line: line.trim(), i }))
      .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line))
      .map(({ line }) => line);
    expect(offenders).toEqual([]);
  });

  /**
   * A `var()` naming a token nobody declares falls back to nothing, silently: the usage tables
   * asked for `--color-border` and `--color-text-muted`, which never existed, and drew no lines.
   */
  it("every variable a rule or a template reads is declared", () => {
    const declared = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
    const sources: [string, string][] = [["public/styles.css", CSS]];
    for (const dir of ["src/routes", "src/views"]) {
      for (const file of readdirSync(resolve(WEB, dir)).filter((f) => f.endsWith(".ts"))) {
        sources.push([`${dir}/${file}`, readFileSync(resolve(WEB, dir, file), "utf8")]);
      }
    }
    const undeclared = sources.flatMap(([name, text]) =>
      [...text.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!).filter((v) => !declared.has(v)).map((v) => `${name}: ${v}`),
    );
    expect([...new Set(undeclared)]).toEqual([]);
  });

  it("no template paints a colour of its own", () => {
    const offenders: string[] = [];
    for (const dir of ["src/routes", "src/views"]) {
      for (const file of readdirSync(resolve(WEB, dir)).filter((f) => f.endsWith(".ts"))) {
        readFileSync(resolve(WEB, dir, file), "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/["'`(:]\s*#[0-9a-fA-F]{6}\b|["'`(:]\s*#[0-9a-fA-F]{3}\b|rgba?\(/.test(line)) offenders.push(`${dir}/${file}:${i + 1}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
