import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Somebody outside is going to read this repo's documentation. These checks are the ones that
 * rot on their own over time: a link to a file that moved, a client name that slipped in, or a
 * cited ADR that was never written.
 */
const ROOT = resolve(import.meta.dirname, "..");
const SPANISH_DOCS = ["README.es.md", "CONTRIBUTING.es.md"];
const DOCS = [
  "README.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "deploy/README.md",
  "config/README.md",
  ...SPANISH_DOCS,
  ...globSync("docs/**/*.md", { cwd: ROOT }),
];

const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

describe("documentation", () => {
  it("there are no broken internal links", () => {
    const broken: string[] = [];
    for (const doc of DOCS) {
      const dir = resolve(ROOT, doc, "..");
      for (const m of read(doc).matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]*)?\)/g)) {
        if (!existsSync(resolve(dir, m[1]!))) broken.push(`${doc} → ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("every ADR cited exists", () => {
    const decisions = read("docs/decisions.md");
    const existing = new Set([...decisions.matchAll(/^## (ADR-\d{4})/gm)].map((m) => m[1]!));
    const cited = new Set<string>();
    for (const doc of DOCS) for (const m of read(doc).matchAll(/\bADR-(\d{4})\b/g)) cited.add(`ADR-${m[1]}`);
    const ghosts = [...cited].filter((a) => !existing.has(a)).sort();
    expect(ghosts).toEqual([]);
  });

  it("no corporate material is left: no clients by name, no domains of our own", () => {
    // ADR-0026 and ADR-0031: opening the code does not mean opening the process. The exception
    // is SECURITY.md, which HAS to say who a vulnerability gets reported to.
    const forbidden = /\b(levelup|boluda|dinacode\.com)\b/i;
    const offenders = DOCS.filter((d) => d !== "SECURITY.md" && forbidden.test(read(d)));
    expect(offenders).toEqual([]);
  });

  /**
   * The product is called **Cortex**. Whoever maintains it is called Dinacode, and that gets
   * signed where it belongs -- the licence, authorship, the GitHub organisation -- but it is not
   * part of the name. "Dinacode Cortex" sounds like one company's product exactly where we want
   * it to sound like a tool anybody can pick up, so it stays out of the documentation.
   */
  it("the product is called Cortex, not «Dinacode Cortex»", () => {
    // Case-sensitive on purpose: `dinacode-cortex` in lowercase is the plugin marketplace's
    // identifier and the path of the old clone (`~/.dinacode-cortex`). Those are technical
    // identities that would break installations if they changed; what is forbidden is using it
    // as the product's NAME. The CHANGELOG is left out: it is history, and rewriting it would be
    // lying about what was published.
    const brandGlued = /Dinacode[ -]Cortex/;
    const offenders = DOCS.filter((d) => d !== "CHANGELOG.md" && brandGlued.test(read(d)));
    expect(offenders).toEqual([]);
  });

  /**
   * The repository is public and it is in English -- all of it, code comments and ADRs
   * included. A repo that switches language halfway is a repo half of which nobody outside can
   * read, and the half they cannot read is the one explaining *why* things are the way they are.
   *
   * Two things stay in Spanish on purpose, and both are DATA rather than prose we wrote: the
   * patterns that match the corpus (`packages/core/src/text.ts`, the deictics in `domain.ts`,
   * the eval fixtures) and the agents' OUTPUT language (`OUTPUT_LANGUAGE` in `mastra.ts`).
   * Anything an external system owns keeps its own spelling too. They are listed below, one by
   * one: an exception that is not written down is indistinguishable from an oversight.
   */
  const SPANISH_ON_PURPOSE = [
    "packages/core/src/text.ts", // CLASSIFY_RULES / MODULE_KEYWORDS / polarityTags: corpus patterns
    "packages/shared/src/domain.ts", // the deictics regex, likewise
    "packages/agents/src/mastra.ts", // OUTPUT_LANGUAGE: a product decision, not a translation
    "packages/core/src/query-intent.ts", // bilingual ES|EN patterns
    "packages/core/src/temporal.ts", // 'Histórico' is Plane's own value
    "packages/core/src/lint.ts", // likewise
    "apps/admin/src/commands/connect-notion.ts", // PROP_KEYS are Notion's property names
    "tests/query-intent.test.ts", // the questions are inputs, not our text
    "docs/how-it-works.md", // the prompt examples, shown in the corpus's language on purpose
  ];

  it("the code and the documentation are in English", () => {
    // Spanish function words: they turn up in any paragraph, and not in English. `qué`/`cómo`
    // carry an accent, which no English word does.
    const spanish = /\b(el|la|los|las|una|unas|unos|porque|además|según|cómo|qué|para|pero|sin|sobre|cuando|donde|desde|esto|esta|este|más|así|también|aunque|mientras|nunca|siempre|puede|deben|hacer|queda|otro|otra|mismo|misma)\b/i;
    const allow = new Set([...SPANISH_ON_PURPOSE, ...SPANISH_DOCS]);
    const sources = [
      ...DOCS,
      ...globSync("packages/*/src/**/*.ts", { cwd: ROOT }),
      ...globSync("apps/*/src/**/*.ts", { cwd: ROOT }),
      ...globSync("tests/**/*.test.ts", { cwd: ROOT }),
    ];
    const offenders: string[] = [];
    for (const f of sources) {
      // This file holds the pattern itself, so it matches every word in it.
      if (allow.has(f) || f === "tests/docs.test.ts") continue;
      const suspicious = read(f)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        // Two different Spanish words on one line: one alone is `no`, `la` in a URL or an
        // identifier, and flagging those would train people to ignore this test.
        .filter(([, l]) => new Set((l.match(new RegExp(spanish, "gi")) ?? []).map((w) => w.toLowerCase())).size >= 2);
      // No `slice`: every one gets shown. With three, you fixed three and the fourth stayed.
      for (const [n, l] of suspicious) offenders.push(`${f}:${n}: ${l.trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  it("every file exempted from English still exists", () => {
    // An allowlist pointing at a file that moved stops exempting anything and starts hiding
    // whatever takes its place.
    expect(SPANISH_ON_PURPOSE.filter((f) => !existsSync(resolve(ROOT, f)))).toEqual([]);
  });

  it("each Spanish-on-purpose file says in English why", () => {
    // The rule is that the exception is data, not prose we wrote. A file that does not explain
    // itself is indistinguishable from one that was simply never translated.
    const unexplained = SPANISH_ON_PURPOSE.filter((f) => !/Spanish|corpus|Plane|Notion/i.test(read(f)));
    expect(unexplained).toEqual([]);
  });

  it("the Spanish entry points exist and point at the English ones", () => {
    for (const es of SPANISH_DOCS) {
      const english = es.replace(".es.md", ".md");
      expect(read(es), `${es} does not link to ${english}`).toContain(english);
      expect(read(english), `${english} does not link to ${es}`).toContain(es);
    }
  });

  it("how we work inside does not slip in", () => {
    // ADR-0031: the code being public does not make the process public. A finding is told by
    // what it teaches -- "this echo scores 0.86-0.88" -- not by how it was found: with how many
    // agents at once, on which machine, with which orchestrator or against which environment.
    // The first helps anybody; the second only describes our kitchen, and it ages badly.
    const internal = /\b(four agents|\d+ agents in parallel|our lab|the harness we use|our server|our machine)\b/i;
    const offenders = DOCS.filter((d) => internal.test(read(d)));
    expect(offenders).toEqual([]);
  });

  it("the CHANGELOG keeps an [Unreleased] section for the next PR", () => {
    expect(read("CHANGELOG.md")).toContain("## [Unreleased]");
  });
});
