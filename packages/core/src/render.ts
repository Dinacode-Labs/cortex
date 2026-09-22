import { getBrandName, packIsASample, packShowing, type ContextEntry } from "@cortex/shared";
import type { ContextPack } from "./context-pack.js";
import type { SaveContextResult } from "./save.js";
import type { SearchHit } from "./vectors.js";

/**
 * Markdown renderers: this is what the MCP tools return and what the hook injects when a
 * session opens. It is in ENGLISH because a model that may be working in any language reads
 * it, and because it often repeats it verbatim to the user. Each entry's CONTENT keeps the
 * language it was written in; what is translated is the scaffolding.
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

interface Section {
  title: string;
  blocks: string[];
  weight: number;
  type?: string;
}

function note(n: number, type?: string): string {
  return type ? `- **+${n} more** not shown (\`type: "${type}"\`)` : `- **+${n} more** not shown`;
}

/**
 * Writes a section with its first `n` entries, saying how many were left out.
 *
 * When none fits, the title and the count still go in: an agent knowing this project has
 * constraints on record is worth far more than not mentioning them, because an absent section
 * reads as "there is nothing here".
 */
function write(s: Section, n: number): string {
  const left = s.blocks.length - n;
  const body = [...s.blocks.slice(0, n), ...(left > 0 ? [note(left, s.type)] : [])];
  return `\n## ${s.title}\n${body.join("\n")}`;
}

/**
 * Splits a budget between sections that ask for different amounts, without the big ones
 * starving the small ones: each gets a share according to its weight, and what one does not
 * spend returns to the pot for the others (level filling). It returns each one's allowance.
 *
 * The weight exists because not all knowledge is worth the same when something has to give: a
 * decision in force governs what the agent is about to do, and an incident from three months
 * ago merely accompanies it. Without weights, splitting across eleven sections left decisions
 * with the same share as how-tos.
 */
function share(costs: number[], weights: number[], budget: number): number[] {
  const allocated = new Array<number>(costs.length).fill(0);
  let pending = costs.map((_, i) => i);
  let pot = budget;
  while (pending.length > 0 && pot > 0) {
    const totalWeight = pending.reduce((a, i) => a + weights[i]!, 0);
    if (totalWeight <= 0) break;
    const perWeight = pot / totalWeight;
    if (perWeight < 1) break;
    const satisfied = pending.filter((i) => costs[i]! <= perWeight * weights[i]!);
    if (satisfied.length === 0) {
      // Nobody fits whole: each keeps its proportional share and that is the end of it.
      for (const i of pending) allocated[i] = Math.floor(perWeight * weights[i]!);
      return allocated;
    }
    for (const i of satisfied) {
      allocated[i] = costs[i]!;
      pot -= costs[i]!;
    }
    pending = pending.filter((i) => costs[i]! > perWeight * weights[i]!);
  }
  return allocated;
}

function howManyFit(s: Section, budget: number): number {
  let n = 0;
  while (n < s.blocks.length && write(s, n + 1).length <= budget) n++;
  return n;
}

export interface RenderPackOptions {
  /**
   * Character cap. Without it, the pack comes out whole.
   *
   * It exists because the hook used to cut the pack with a `slice()` at the end: on a project
   * with two hundred entries, the agent got the decisions and **nothing else** -- the
   * constraints, the risks and the debt fell outside the scissors with nobody the wiser. A
   * blind cut is not a summary: it loses precisely whatever did not fit, by the alphabetical
   * order of the scaffolding. With a cap, each section gets its share and what one does not
   * spend returns to the pot, so something from every kind of knowledge always arrives.
   */
  maxChars?: number;
}

export function renderContextPack(pack: ContextPack, opts: RenderPackOptions = {}): string {
  // The warning is glued to EVERY entry involved, not put in a section of its own: if it goes
  // at the end, the agent has already believed the entry by the time the warning arrives.
  const warnings = new Map<string, string>();
  for (const c of pack.conflicts ?? []) {
    const lines: string[] = [];
    if (c.entries.length > 0) {
      const withWhat = c.entries.map((e) => `"${e.label}" (recorded ${e.recordedLater ? "later" : "earlier"})`).join(", ");
      lines.push(`  ⚠️ Conflicts with ${withWhat}. Both are still recorded as current: check which one holds before relying on this.`);
    }
    for (const a of c.areas) {
      lines.push(`  ⚠️ Touches "${a.entity}", which is recorded as contradicting ${a.against.map((x) => `"${x}"`).join(", ")}. That corner is disputed: check it before relying on this.`);
    }
    if (lines.length > 0) warnings.set(c.entryId, lines.join("\n"));
  }
  const line = (e: ContextEntry): string => {
    const warning = warnings.get(e.id);
    return warning ? `${entryLine(e)}\n${warning}` : entryLine(e);
  };

  const sections: Section[] = [
    ...pack.sections.map((s) => ({ title: s.title, weight: s.weight, type: s.type, blocks: s.entries.map(line) })),
    { title: "Sensitive modules", weight: 1, blocks: pack.sensitiveModules.map((m) => `- ${m}`) },
    {
      title: "Most relevant to the area you asked about",
      // What was asked for by hand carries weight: somebody said explicitly where they are.
      weight: 3,
      blocks: pack.relevantToArea.map((h) => `- (${h.score.toFixed(2)}) ${h.entry.title} — ${h.entry.summary ?? ""}`),
    },
  ].filter((s) => s.blocks.length > 0);

  const entriesShown = (counts: number[]): number => sections.reduce((a, s, i) => a + (s.type ? counts[i]! : 0), 0);
  const total = entriesShown(sections.map((s) => s.blocks.length));

  const head = (shown: number, explain: boolean): string => {
    const cut = shown < total || shown < pack.totalEntries;
    const count = cut ? packShowing(shown, pack.totalEntries) : `${pack.totalEntries} ${pack.totalEntries === 1 ? "entry" : "entries"} in total`;
    return [
      `# Context Pack — ${pack.project}`,
      `_${count} · generated ${pack.generatedAt.toISOString()}_`,
      ...(cut && explain ? [`> ${packIsASample()}`] : []),
    ].join("\n");
  };

  const cap = opts.maxChars;
  if (!cap || cap <= 0) {
    const whole = sections.map((s) => s.blocks.length);
    return [head(entriesShown(whole), true), ...sections.map((s) => write(s, s.blocks.length))].join("\n");
  }

  const layout = (explain: boolean): { text: string; counts: number[] } => {
    const join = (counts: number[]) =>
      [head(entriesShown(counts), explain), ...sections.map((s, i) => write(s, counts[i]!))].join("\n");

    const shares = share(
      sections.map((s) => write(s, s.blocks.length).length),
      sections.map((s) => s.weight),
      Math.max(cap - head(0, explain).length - sections.length, 0),
    );
    const counts = sections.map((s, i) => howManyFit(s, shares[i]!));

    const fits = () => join(counts).length <= cap;
    for (let i = sections.length - 1; i >= 0 && !fits(); i--) {
      while (counts[i]! > 0 && !fits()) counts[i] = counts[i]! - 1;
    }
    for (let pass = 0; pass < sections.length; pass++) {
      let moved = false;
      for (let i = 0; i < sections.length; i++) {
        while (counts[i]! < sections[i]!.blocks.length) {
          counts[i] = counts[i]! + 1;
          if (fits()) moved = true;
          else {
            counts[i] = counts[i]! - 1;
            break;
          }
        }
      }
      if (!moved) break;
    }
    return { text: join(counts), counts };
  };

  const explained = layout(true);
  const plain = layout(false);
  const kept = (counts: number[]): number => counts.filter((n) => n > 0).length;
  return explained.text.length <= cap && kept(explained.counts) >= kept(plain.counts) ? explained.text : plain.text;
}
