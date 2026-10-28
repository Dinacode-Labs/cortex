import { html } from "hono/html";
import type { UsageDay } from "@cortex/core";
import type { Html } from "./layout.js";

export const formatCount = (n: number): string => n.toLocaleString("en-US");

/** A dash rather than `$0`: with no price on file the estimate is zero, and that is not "free" (ADR-0021). */
export const formatUsd = (n: number): string => (n > 0 ? `$${n.toFixed(4)}` : "—");

export const compactNumber = (n: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** The axis top: the next 1, 2 or 5 of the same magnitude, so its half is a round number too. */
export function niceCeiling(n: number): number {
  if (n <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].find((step) => step * magnitude >= n)! * magnitude;
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (day: string): string => DAY.format(new Date(`${day}T00:00:00Z`));

/** A day that spent anything stays visible, however small next to the busiest. */
function barHeight(value: number, top: number): number {
  if (value <= 0) return 0;
  return Math.max(1, Math.round((value / top) * 1000) / 10);
}

function dayDetail(d: UsageDay): string {
  const cost = d.costUsd > 0 ? ` · ${formatUsd(d.costUsd)}` : "";
  return `${dayLabel(d.day)} · ${formatCount(d.totalTokens)} tokens (${formatCount(d.inputTokens)} in, ${formatCount(d.outputTokens)} out) · ${formatCount(d.calls)} ${d.calls === 1 ? "call" : "calls"}${cost}`;
}

/**
 * Bars in HTML rather than a drawing: the page has no script (ADR-0042), and a scaled SVG shrinks
 * its own labels on a phone. The hover is the browser's `title`; the table says the same in text.
 */
export function dailyTokensChart(days: UsageDay[]): Html {
  const top = niceCeiling(Math.max(0, ...days.map((d) => d.totalTokens)));
  const labelled = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((i, at, all) => all.indexOf(i) === at);
  return html`<figure class="usage-chart">
    <div class="chart-plot">
      <div class="chart-ticks" aria-hidden="true">${[top, top / 2, 0].map((t) => html`<span>${compactNumber(t)}</span>`)}</div>
      <div class="chart-bars" aria-hidden="true">${days.map(
        (d) => html`<span class="chart-day" title="${dayDetail(d)}"><span class="chart-bar" style="--bar-height:${barHeight(d.totalTokens, top)}%"></span></span>`,
      )}</div>
      <div class="chart-dates" aria-hidden="true">${labelled.map((i) => html`<span>${dayLabel(days[i]!.day)}</span>`)}</div>
    </div>
    <details class="chart-table">
      <summary>As a table</summary>
      <table>
        <tr><th>Day</th><th class="num">Calls</th><th class="num">Tokens in</th><th class="num">Tokens out</th><th class="num">Cost</th></tr>
        ${[...days].reverse().map(
          (d) => html`<tr><td>${dayLabel(d.day)}</td><td class="num">${formatCount(d.calls)}</td><td class="num">${formatCount(d.inputTokens)}</td><td class="num">${formatCount(d.outputTokens)}</td><td class="num">${formatUsd(d.costUsd)}</td></tr>`,
        )}
      </table>
    </details>
  </figure>`;
}
