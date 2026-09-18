import { canonicalize } from "@cortex/core";

/**
 * The matching between what the distiller emitted and what a window was supposed to produce.
 *
 * It lives apart from the command and takes no LLM, no database and no filesystem: that is
 * what allows the rule that decides whether a window passed to be tested on its own
 * (`tests/eval-distill-matcher.test.ts`). Whatever cannot be exercised without a model ends
 * up being defended with hand-picked examples, which is the same as not defending it.
 */

/** What the distiller returns. Structural on purpose: this module does not import `agents`. */
export interface DistillItem {
  type: string;
  title: string;
  content: string;
}

/** An item that HAS to come out of a window: its type, plus keywords in the title or content. */
export interface GoldExpectation {
  type: string;
  must_mention: string[];
}

/** A keyword set that must NOT appear in any item of the window. */
export interface GoldForbidden {
  must_mention: string[];
}

export interface GoldWindow {
  window: string;
  expected: GoldExpectation[];
  forbidden?: GoldForbidden[];
}

export interface ExpectationMatch {
  expectation: GoldExpectation;
  /** Index of the item satisfying it, or -1. */
  matchedItem: number;
  /** Index of the item mentioning every keyword under ANOTHER type, or -1. */
  mistypedItem: number;
}

export interface ForbiddenLeak {
  keywords: string[];
  item: number;
}

export interface WindowMatch {
  window: string;
  items: number;
  expected: number;
  matched: number;
  mistyped: number;
  forbidden: number;
  expectations: ExpectationMatch[];
  leaks: ForbiddenLeak[];
}

export interface DistillSummary {
  windows: number;
  items: number;
  expected: number;
  matched: number;
  mistyped: number;
  forbidden: number;
  leaks: number;
  windowsWithoutItems: number;
  recall: number;
  leakRate: number;
  itemsPerWindow: number;
}

/** Accent- and case-insensitive, because the corpus is Spanish and a model writes it either way. */
function mentionsAll(text: string, keywords: string[]): boolean {
  return keywords.every((k) => text.includes(canonicalize(k)));
}

export function matchDistillItems(items: DistillItem[], gold: GoldWindow): WindowMatch {
  const texts = items.map((i) => canonicalize(`${i.title} ${i.content}`));
  const forbidden = gold.forbidden ?? [];
  const taken = new Set<number>();

  // Each item answers for one expectation at most: an item that mentions everything would
  // otherwise count as two hits and a window would pass by emitting a single summary of itself.
  const matchedItem = gold.expected.map((e) => {
    const i = texts.findIndex((t, n) => !taken.has(n) && items[n]!.type === e.type && mentionsAll(t, e.must_mention));
    if (i >= 0) taken.add(i);
    return i;
  });
  // A second pass, and not one loop: an item of the right type must never be spent as the
  // mistyped evidence of an earlier expectation while the expectation it belongs to goes unmatched.
  const mistypedItem = gold.expected.map((e, k) => {
    if (matchedItem[k]! >= 0) return -1;
    const i = texts.findIndex((t, n) => !taken.has(n) && mentionsAll(t, e.must_mention));
    if (i >= 0) taken.add(i);
    return i;
  });

  const leaks: ForbiddenLeak[] = [];
  for (const f of forbidden) {
    // With no keywords every text "mentions them all", which would report a leak on any item.
    if (f.must_mention.length === 0) continue;
    const item = texts.findIndex((t) => mentionsAll(t, f.must_mention));
    if (item >= 0) leaks.push({ keywords: f.must_mention, item });
  }

  return {
    window: gold.window,
    items: items.length,
    expected: gold.expected.length,
    matched: matchedItem.filter((i) => i >= 0).length,
    mistyped: mistypedItem.filter((i) => i >= 0).length,
    forbidden: forbidden.filter((f) => f.must_mention.length > 0).length,
    expectations: gold.expected.map((expectation, k) => ({
      expectation,
      matchedItem: matchedItem[k]!,
      mistypedItem: mistypedItem[k]!,
    })),
    leaks,
  };
}

export function summarizeDistillMatches(matches: WindowMatch[]): DistillSummary {
  const total = (pick: (m: WindowMatch) => number): number => matches.reduce((s, m) => s + pick(m), 0);
  const expected = total((m) => m.expected);
  const forbidden = total((m) => m.forbidden);
  const items = total((m) => m.items);
  return {
    windows: matches.length,
    items,
    expected,
    matched: total((m) => m.matched),
    mistyped: total((m) => m.mistyped),
    forbidden,
    leaks: total((m) => m.leaks.length),
    windowsWithoutItems: matches.filter((m) => m.items === 0).length,
    // A window with nothing expected does not average into the recall: there is no fraction to
    // measure, and counting it as 1.0 would make a distiller that emits nothing look perfect.
    recall: expected === 0 ? 0 : total((m) => m.matched) / expected,
    leakRate: forbidden === 0 ? 0 : total((m) => m.leaks.length) / forbidden,
    itemsPerWindow: matches.length === 0 ? 0 : items / matches.length,
  };
}
