import type { EmailMessage } from "../../auth/domain/email.js";
import type { QueuedMemo } from "../../knowledge/domain/review-queue.js";

export const UNSUBSCRIBE_TTL_DAYS = 30;

export interface WaitingProject {
  projectId: string;
  name: string;
  slug: string;
  subscribedAt: Date;
  queued: QueuedMemo[];
}

export interface DigestLine {
  projectId: string;
  name: string;
  slug: string;
  waiting: number;
  newSinceLastDigest: number;
}

export interface DigestLinks {
  webUrl: string;
  unsubscribeUrl: (line: DigestLine) => string;
}

const later = (a: Date | null, b: Date): Date => (a && a > b ? a : b);

/** Null when nothing came up since the previous digest: the same number every morning teaches
 *  people to ignore it (ADR-0097). What waited before a project was switched on is not new, or
 *  the first digest would be its whole backlog. */
export function digestFor(projects: WaitingProject[], lastSentAt: Date | null): DigestLine[] | null {
  const lines = projects
    .filter((project) => project.queued.length > 0)
    .map((project) => {
      const since = later(lastSentAt, project.subscribedAt);
      return {
        projectId: project.projectId,
        name: project.name,
        slug: project.slug,
        waiting: project.queued.length,
        newSinceLastDigest: project.queued.filter((memo) => memo.lastQueuedAt > since).length,
      };
    })
    .sort((a, b) => b.newSinceLastDigest - a.newSinceLastDigest || b.waiting - a.waiting || a.name.localeCompare(b.name));
  return lines.some((line) => line.newSinceLastDigest > 0) ? lines : null;
}

const newMemos = (n: number): string => (n === 1 ? "1 new memo" : `${n} new memos`);

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const tally = (line: DigestLine): string =>
  line.newSinceLastDigest > 0 ? `${line.waiting} waiting, ${line.newSinceLastDigest} new` : `${line.waiting} waiting`;

const INTRO =
  "These memos wait in Review for someone on the team to say whether they hold: older ones something newer was saved about, and new ones nobody has checked yet.";
const WHY = "You get this because you switched on the daily review email in these projects' settings.";

/** Where and how many, never what: a memo can hold what a person would not forward (ADR-0097). */
export function composeReviewDigest(to: string, lines: DigestLine[], brand: string, links: DigestLinks): EmailMessage {
  const newTotal = lines.reduce((n, line) => n + line.newSinceLastDigest, 0);
  const reviewUrl = (line: DigestLine): string => `${links.webUrl}/p/${encodeURIComponent(line.slug)}/review`;
  return {
    to,
    subject: `${newMemos(newTotal)} to review in ${brand}`,
    text: [
      INTRO,
      ...lines.map((line) => `${line.name}: ${tally(line)}\n${reviewUrl(line)}\nTurn it off for ${line.name}: ${links.unsubscribeUrl(line)}`),
      WHY,
    ].join("\n\n"),
    html:
      `<p>${escapeHtml(INTRO)}</p>` +
      `<ul>${lines
        .map(
          (line) =>
            `<li><a href="${escapeHtml(reviewUrl(line))}">${escapeHtml(line.name)}</a>: ${tally(line)} · ` +
            `<a href="${escapeHtml(links.unsubscribeUrl(line))}">turn it off for this project</a></li>`,
        )
        .join("")}</ul>` +
      `<p style="font-size:13px">${escapeHtml(WHY)}</p>`,
  };
}
