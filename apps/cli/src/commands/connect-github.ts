import { execFileSync } from "node:child_process";
import { apiPost } from "@cortex/client";
import type { BatchItem } from "@cortex/shared";

/**
 * Conector GitHub: ingiere PRs e issues de un repo en un proyecto, vía el CLI `gh`
 * (usa su autenticación). Escribe a través de la API autenticada de Cortex
 * (`POST /capture/batch`): atribución (created_by=email) + permisos. Requiere
 * `cortex auth login` y el servidor en marcha.
 *
 * Uso: cortex connect-github "<slug>" <owner/repo> [maxItems]
 * Requiere `gh` en PATH y autenticado con acceso al repo.
 */

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

interface PR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  mergedAt: string | null;
  author?: { login?: string };
  labels?: { name: string }[];
  url: string;
}
interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels?: { name: string }[];
  url: string;
}

export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  const repo = args[1];
  const max = Number(args[2] ?? "100");
  if (!slug || !repo) {
    console.error('Usage: cortex connect-github "<slug>" <owner/repo> [maxItems]');
    process.exitCode = 1;
    return;
  }

  console.log(`Ingesting GitHub ${repo} → "${slug}"…`);
  const prs = JSON.parse(
    gh(["pr", "list", "-R", repo, "--state", "all", "--limit", String(max),
        "--json", "number,title,body,state,mergedAt,author,labels,url"]),
  ) as PR[];
  const issues = JSON.parse(
    gh(["issue", "list", "-R", repo, "--state", "all", "--limit", String(max),
        "--json", "number,title,body,state,labels,url"]),
  ) as Issue[];
  console.log(`  ${prs.length} pull requests, ${issues.length} issues.`);

  const items: BatchItem[] = [];
  for (const pr of prs) {
    const labels = (pr.labels ?? []).map((l) => l.name);
    const header = `[GitHub PR #${pr.number} · ${pr.state}${pr.mergedAt ? " (merged)" : ""} · ${repo}]`;
    items.push({
      content: `${header}\n${pr.title}\n\n${(pr.body ?? "").slice(0, 4000)}`.trim(),
      title: pr.title.slice(0, 120),
      type: "pr_summary",
      confidence: pr.mergedAt ? "high" : "medium",
      sourceType: "github_pr",
      sourceReference: `${repo}#${pr.number}`,
      metadata: { source: "github", kind: "pr", number: pr.number, state: pr.state, url: pr.url, author: pr.author?.login, labels },
    });
  }
  for (const it of issues) {
    const labels = (it.labels ?? []).map((l) => l.name);
    const header = `[GitHub issue #${it.number} · ${it.state} · ${repo}]`;
    items.push({
      content: `${header}\n${it.title}\n\n${(it.body ?? "").slice(0, 4000)}`.trim(),
      title: it.title.slice(0, 120),
      type: it.state.toLowerCase() === "closed" ? "ticket_resolution" : "incident",
      sourceType: "github_issue",
      sourceReference: `${repo}#${it.number}`,
      metadata: { source: "github", kind: "issue", number: it.number, state: it.state, url: it.url, labels },
    });
  }

  const r = await apiPost<{ results?: { action: string }[]; error?: string }>("/capture/batch", { slug, items });
  if (!r.ok) {
    console.error(`✗ Capture failed (${r.status}): ${r.data.error ?? "check cortex auth login and that the server is running"}`);
    process.exitCode = 1;
    return;
  }
  const added = (r.data.results ?? []).filter((x) => x.action === "added").length;
  console.log(`GitHub: ${added} new, ${(r.data.results?.length ?? 0) - added} already known.`);
}


