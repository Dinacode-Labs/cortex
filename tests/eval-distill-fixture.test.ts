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

const SETS = [
  { language: "es", dir: "windows", gold: "gold.json" },
  { language: "en", dir: "windows-en", gold: "gold-en.json" },
];

const load = (set: (typeof SETS)[number]): { gold: GoldWindow[]; files: string[] } => ({
  gold: JSON.parse(readFileSync(join(FIXTURES, set.gold), "utf8")) as GoldWindow[],
  files: readdirSync(join(FIXTURES, set.dir)).filter((f) => f.endsWith(".txt")).sort(),
});

const keywordsOf = (g: GoldWindow): string[][] => [
  ...g.expected.map((e) => e.must_mention),
  ...(g.forbidden ?? []).map((f) => f.must_mention),
];

describe("the distillation fixture", () => {
  /** A window with no entry is never evaluated, and an entry with no window aborts the run. */
  it("every window has an expectation and every expectation has a window", () => {
    const orphans: string[] = [];
    for (const set of SETS) {
      const { gold, files } = load(set);
      const named = new Set(gold.map((g) => g.window));
      for (const f of files) if (!named.has(f)) orphans.push(`${set.dir}/${f} has no entry in ${set.gold}`);
      for (const g of gold) if (!files.includes(g.window)) orphans.push(`${set.gold} names ${g.window}, which does not exist`);
    }
    expect(orphans).toEqual([]);
  });

  /** The two runs are read side by side; if the cases drift apart there is nothing to compare. */
  it("both languages cover the same cases", () => {
    const [es, en] = SETS.map((s) => load(s).files);
    expect(en).toEqual(es);
  });

  /**
   * A window is meant to be a slice of a real session, in the shape `condenseSession` produces.
   * Prose that never went through that format measures the distiller against an input it will
   * never see.
   */
  it("the windows look like what condenseSession produces", () => {
    const offenders: string[] = [];
    for (const set of SETS) {
      for (const f of load(set).files) {
        const text = readFileSync(join(FIXTURES, set.dir, f), "utf8").trim();
        if (text.length > WINDOW_CHARS) offenders.push(`${set.dir}/${f}: ${text.length} characters, over ${WINDOW_CHARS}`);
        const turns = text.split("\n\n");
        if (turns.length < 2) offenders.push(`${set.dir}/${f}: fewer than two turns`);
        for (const [i, turn] of turns.entries()) {
          if (!/^(USER|ASSISTANT): /.test(turn)) offenders.push(`${set.dir}/${f}: turn ${i + 1} starts with "${turn.slice(0, 24)}…"`);
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
    for (const set of SETS) {
      const { gold } = load(set);
      for (const g of gold) {
        const window = canonicalize(readFileSync(join(FIXTURES, set.dir, g.window), "utf8"));
        for (const keywords of keywordsOf(g)) {
          for (const k of keywords) {
            if (!window.includes(canonicalize(k))) unfindable.push(`${set.gold} → ${g.window}: "${k}"`);
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
    for (const set of SETS) {
      for (const g of load(set).gold) {
        for (const e of g.expected) if (!types.has(e.type)) unknown.push(`${set.gold} → ${g.window}: "${e.type}"`);
      }
    }
    expect(unknown).toEqual([]);
  });

  /**
   * The distiller answers in Spanish whatever it is fed (`OUTPUT_LANGUAGE` in
   * `packages/agents/src/mastra.ts`), so the English set can only be annotated with keywords
   * that survive the translation: names, identifiers and stems. A Spanish spelling in the
   * English gold means somebody annotated the output language rather than the subject, and
   * that window would then measure translation instead of judgement.
   */
  it("the English gold is annotated with language-invariant keywords", () => {
    const spanish: string[] = [];
    for (const g of load(SETS[1]!).gold) {
      for (const keywords of keywordsOf(g)) {
        for (const k of keywords) if (/[áéíóúüñ]/i.test(k)) spanish.push(`gold-en.json → ${g.window}: "${k}"`);
      }
    }
    expect(spanish).toEqual([]);
  });
});
