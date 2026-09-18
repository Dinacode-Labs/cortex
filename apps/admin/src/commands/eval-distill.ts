import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getLlmConfig } from "@cortex/shared";
import { distill, shutdownObservability } from "@cortex/agents";
import { matchDistillItems, summarizeDistillMatches, type DistillItem, type GoldWindow, type WindowMatch } from "./eval-distill-match.js";

/**
 * `cortex-admin eval-distill` -- measures what the distiller keeps, drops and mistypes.
 *
 * `eval` measures retrieval: whether what is already stored can be found. Nothing measured the
 * step before it, which decides WHAT gets stored, so every change to the distiller's prompt was
 * an opinion. This answers the same question that one does -- did it get better or worse? --
 * over a fixed set of transcript windows with an annotated expectation each.
 *
 * The windows are invented (`tests/fixtures/eval/distill/<language>/`) and not real sessions:
 * an eval exists to compare runs, and real sessions change every day. One directory per
 * language, each holding its own windows and its own gold: the two are useless apart, and
 * adding a language has to be copying a directory rather than editing this file.
 *
 *   cortex-admin eval-distill                    the English set
 *   cortex-admin eval-distill --lang es          the same eight cases in the corpus's language
 *   cortex-admin eval-distill --verbose          plus every item emitted
 *   cortex-admin eval-distill --windows <dir> --gold <file>    a fixture from outside the repo
 */

/** The fictional project the whole eval corpus is about (`tests/fixtures/eval/retrieval/`). */
const PROJECT = "Nébula";

/**
 * The repository is public and English (ADR-0064), so that is what somebody who clones it and
 * runs this without arguments gets. It is still explicit in the path rather than being the
 * directory with no suffix: no language is the implicit one, whichever goes first.
 *
 * Worth knowing when reading its numbers: the agents answer in Spanish whatever they are fed
 * (`OUTPUT_LANGUAGE`), so the default set measures a session that is NOT in the language of the
 * corpus. `--lang es` is the one that measures the two matching.
 */
const DEFAULT_LANGUAGE = "en";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

const ROOT = new URL("../../../../", import.meta.url).pathname;
const FIXTURES_DIR = join(ROOT, "tests/fixtures/eval/distill");

function table(rows: string[][]): string {
  const columns = rows[0]?.length ?? 0;
  const widths = Array.from({ length: columns }, (_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows
    .map((r, n) => {
      const line = r.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
      return n === 0 ? `${line}\n${widths.map((w) => "─".repeat(w)).join("  ")}` : line;
    })
    .join("\n");
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function preview(item: DistillItem): string {
  const content = item.content.replace(/\s+/g, " ").trim();
  return `${item.type} · ${item.title} · ${content.slice(0, 120)}${content.length > 120 ? "…" : ""}`;
}

export async function run(args: string[]): Promise<void> {
  if (!getLlmConfig()) {
    console.error(
      "eval-distill needs an LLM configured: the distiller IS the model.\n" +
        "  There is nothing to fall back on here. With LLM_PROVIDER=none, distill() returns\n" +
        "  no items for every window, and the table would print a perfect zero that says\n" +
        "  nothing about the prompt.\n" +
        "  Set LLM_PROVIDER and its credentials in .env (see .env.example) and run it again.",
    );
    process.exitCode = 1;
    return;
  }
  try {
    await evalDistill(args);
  } finally {
    await shutdownObservability();
  }
}

async function evalDistill(args: string[]): Promise<void> {
  const verbose = args.includes("--verbose");
  const language = flag(args, "lang") ?? DEFAULT_LANGUAGE;
  const set = join(FIXTURES_DIR, language);
  const custom = flag(args, "windows") ?? flag(args, "gold");
  if (!custom && !existsSync(set)) {
    const available = readdirSync(FIXTURES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    console.error(`There is no fixture for --lang ${language}. There is one for: ${available.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const windowsDir = flag(args, "windows") ?? join(set, "windows");
  const goldFile = flag(args, "gold") ?? join(set, "gold.json");

  const gold = JSON.parse(readFileSync(goldFile, "utf8")) as GoldWindow[];
  const files = new Set(readdirSync(windowsDir).filter((f) => f.endsWith(".txt")));
  const missing = gold.filter((g) => !files.has(g.window)).map((g) => g.window);
  if (missing.length > 0) {
    console.error(`The gold file names windows that are not in ${windowsDir}: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const unlisted = [...files].filter((f) => !gold.some((g) => g.window === f)).sort();
  if (unlisted.length > 0) console.warn(`⚠️  No expectation in the gold file, not evaluated: ${unlisted.join(", ")}\n`);

  const model = getLlmConfig("distiller");
  // A run says which set it came from: two languages are never averaged into one number, so a
  // table that does not name its own set is a table nobody can compare against anything.
  const source = custom ? windowsDir : language;
  console.log(`Distilling ${plural(gold.length, "window")} (${source}) with ${model?.provider}/${model?.model}...`);

  const matches: WindowMatch[] = [];
  const emitted = new Map<string, DistillItem[]>();
  for (const g of gold) {
    const window = readFileSync(join(windowsDir, g.window), "utf8");
    const items = await distill(PROJECT, window);
    emitted.set(g.window, items);
    matches.push(matchDistillItems(items, g));
    console.log(`  ${g.window} → ${plural(items.length, "item")}`);
  }

  const summary = summarizeDistillMatches(matches);
  const rows: string[][] = [["window", "items", "expected", "matched", "recall", "mistyped", "leaks"]];
  for (const m of matches) {
    rows.push([
      m.window,
      String(m.items),
      String(m.expected),
      String(m.matched),
      // A window that expects nothing has no fraction to show, and printing 1.000 would reward
      // a distiller for staying silent exactly where staying silent is the easy part.
      m.expected === 0 ? "—" : (m.matched / m.expected).toFixed(3),
      String(m.mistyped),
      `${m.leaks.length}/${m.forbidden}`,
    ]);
  }
  rows.push([
    "TOTAL",
    String(summary.items),
    String(summary.expected),
    String(summary.matched),
    summary.recall.toFixed(3),
    String(summary.mistyped),
    `${summary.leaks}/${summary.forbidden}`,
  ]);

  console.log(`\n# Distillation eval — ${PROJECT}`);
  console.log(`_${plural(matches.length, "window")} · ${source} · ${model?.provider}/${model?.model}_\n`);
  console.log(table(rows));
  console.log(
    `\nexpected recall ${summary.recall.toFixed(3)} · forbidden leaks ${summary.leakRate.toFixed(3)} · ` +
      `mistyped ${summary.mistyped} · items per window ${summary.itemsPerWindow.toFixed(2)} · ` +
      `windows with zero items ${summary.windowsWithoutItems}/${summary.windows}`,
  );

  // What failed, always: a number that does not say which window it comes from cannot be acted on.
  const failing = matches.filter((m) => m.matched < m.expected || m.leaks.length > 0);
  if (failing.length > 0) {
    console.log(`\n## Windows that did not come out clean (${failing.length})`);
    for (const m of failing) {
      console.log(`- ${m.window}`);
      for (const e of m.expectations) {
        if (e.matchedItem >= 0) continue;
        const keywords = e.expectation.must_mention.join(" + ");
        if (e.mistypedItem >= 0) {
          const item = emitted.get(m.window)?.[e.mistypedItem];
          console.log(`  ✗ ${e.expectation.type} [${keywords}] came out as "${item?.type}": ${item?.title}`);
        } else {
          console.log(`  ✗ ${e.expectation.type} [${keywords}] did not come out`);
        }
      }
      for (const leak of m.leaks) {
        const item = emitted.get(m.window)?.[leak.item];
        console.log(`  ⚠ forbidden [${leak.keywords.join(" + ")}] kept as "${item?.type}": ${item?.title}`);
      }
    }
  }

  if (verbose) {
    console.log("\n## Everything emitted");
    for (const m of matches) {
      console.log(`\n### ${m.window}`);
      const items = emitted.get(m.window) ?? [];
      if (items.length === 0) console.log("  (nothing)");
      for (const item of items) console.log(`  - ${preview(item)}`);
    }
  }
}
