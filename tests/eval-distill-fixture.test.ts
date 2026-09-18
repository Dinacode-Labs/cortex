import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { contextEntryType } from "@cortex/shared";
import { canonicalize } from "@cortex/core";
import type { GoldWindow } from "../apps/admin/src/commands/eval-distill-match.js";

/**
 * The distillation fixture, checked without spending a single call on a model.
 *
 * Everything here is a rule that breaks in silence: running `eval-distill` costs money and
 * minutes, so a window with no expectation, a keyword that cannot possibly be found or a type
 * that does not exist does not show up as an error. It shows up as a number slightly worse
 * than the previous one, which is indistinguishable from the prompt having got worse, and that
 * is the one thing this eval exists to tell apart.
 */
const FIXTURES = resolve(import.meta.dirname, "fixtures/eval/distill");

/** `CORTEX_SESSIONS_WINDOW_CHARS` default: a bigger window is not what the pipeline produces. */
const WINDOW_CHARS = 9000;

/**
 * Read off the disk rather than listed here: a language added tomorrow gets checked by all of
 * this without anybody remembering to come back and add it to a list.
 */
const LANGUAGES = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const windowsOf = (language: string): string[] =>
  readdirSync(join(FIXTURES, language, "windows")).filter((f) => f.endsWith(".txt")).sort();

const goldOf = (language: string): GoldWindow[] =>
  JSON.parse(readFileSync(join(FIXTURES, language, "gold.json"), "utf8")) as GoldWindow[];

const keywordsOf = (g: GoldWindow): string[][] => [
  ...g.expected.map((e) => e.must_mention),
  ...(g.forbidden ?? []).map((f) => f.must_mention),
];

describe("the distillation fixture", () => {
  it("there is at least one set, and each one is a language of its own", () => {
    // The whole point of the layout: no set without a language, and no language without a set.
    expect(LANGUAGES.length).toBeGreaterThan(0);
    expect(LANGUAGES).toContain("es");
  });

  /** A window with no entry is never evaluated, and an entry with no window aborts the run. */
  it("every window has an expectation and every expectation has a window", () => {
    const orphans: string[] = [];
    for (const language of LANGUAGES) {
      const gold = goldOf(language);
      const files = windowsOf(language);
      const named = new Set(gold.map((g) => g.window));
      for (const f of files) if (!named.has(f)) orphans.push(`${language}: ${f} has no entry in its gold`);
      for (const g of gold) if (!files.includes(g.window)) orphans.push(`${language}: the gold names ${g.window}, which does not exist`);
    }
    expect(orphans).toEqual([]);
  });

  /** The runs are read side by side; if the cases drift apart there is nothing to compare. */
  it("every language covers the same cases", () => {
    const reference = windowsOf("es");
    const drifted = LANGUAGES.filter((l) => JSON.stringify(windowsOf(l)) !== JSON.stringify(reference));
    expect(drifted).toEqual([]);
  });

  /**
   * A window is meant to be a slice of a real session, in the shape `condenseSession` produces.
   * Prose that never went through that format measures the distiller against an input it will
   * never see.
   */
  it("the windows look like what condenseSession produces", () => {
    const offenders: string[] = [];
    for (const language of LANGUAGES) {
      for (const f of windowsOf(language)) {
        const text = readFileSync(join(FIXTURES, language, "windows", f), "utf8").trim();
        if (text.length > WINDOW_CHARS) offenders.push(`${language}/${f}: ${text.length} characters, over ${WINDOW_CHARS}`);
        const turns = text.split("\n\n");
        if (turns.length < 2) offenders.push(`${language}/${f}: fewer than two turns`);
        for (const [i, turn] of turns.entries()) {
          if (!/^(USER|ASSISTANT): /.test(turn)) offenders.push(`${language}/${f}: turn ${i + 1} starts with "${turn.slice(0, 24)}…"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A keyword that is not in its own window is either a typo or an expectation that only an
   * invented answer could satisfy, and neither shows up as an error: an `expected` that cannot
   * be met reads as a prompt that keeps too little, and a `forbidden` that cannot be found reads
   * as a window that came out clean. Both are silent, and both point the blame at the prompt.
   *
   * Inflection is where this goes wrong first, which is why keywords are stems where the ending
   * is not the point: the window says "retroactiva" and a model summarising it may well write
   * "retroactivo" or "retroactivamente".
   */
  it("every keyword appears in its own window", () => {
    const unfindable: string[] = [];
    for (const language of LANGUAGES) {
      for (const g of goldOf(language)) {
        const window = canonicalize(readFileSync(join(FIXTURES, language, "windows", g.window), "utf8"));
        for (const keywords of keywordsOf(g)) {
          for (const k of keywords) {
            if (!window.includes(canonicalize(k))) unfindable.push(`${language} → ${g.window}: "${k}"`);
          }
        }
      }
    }
    expect(unfindable).toEqual([]);
  });

  /**
   * An expectation of a type that is not in the domain can never be matched: it would be
   * reported for ever as a miss, and blamed on the prompt.
   */
  it("the expected types exist in the domain", () => {
    const types = new Set<string>(contextEntryType.options);
    const unknown: string[] = [];
    for (const language of LANGUAGES) {
      for (const g of goldOf(language)) {
        for (const e of g.expected) if (!types.has(e.type)) unknown.push(`${language} → ${g.window}: "${e.type}"`);
      }
    }
    expect(unknown).toEqual([]);
  });

  /**
   * The distiller answers in Spanish whatever it is fed (`OUTPUT_LANGUAGE` in
   * `packages/agents/src/mastra.ts`), so any set that is not the Spanish one can only be
   * annotated with keywords that survive the translation: names, identifiers and stems. A
   * Spanish spelling in another language's gold means somebody annotated the output language
   * rather than the subject, and that window would then measure translation, not judgement.
   */
  it("the other languages are annotated with language-invariant keywords", () => {
    const spanish: string[] = [];
    for (const language of LANGUAGES.filter((l) => l !== "es")) {
      for (const g of goldOf(language)) {
        for (const keywords of keywordsOf(g)) {
          for (const k of keywords) if (/[áéíóúüñ]/i.test(k)) spanish.push(`${language} → ${g.window}: "${k}"`);
        }
      }
    }
    expect(spanish).toEqual([]);
  });
});
