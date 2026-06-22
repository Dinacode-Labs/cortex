import { execFileSync } from "node:child_process";
import { closeSql } from "@cortex/database";
import { saveContext } from "./operations.js";

/**
 * Conector GitHub: ingiere PRs e issues de un repo en un proyecto, vía el CLI `gh`
 * (usa su autenticación). Cada PR/issue se guarda como entrada de conocimiento;
 * el grafo (enrich) luego la conecta con las entidades del proyecto (p.ej. los
 * tickets PUBLI que cita un PR).
 *
 * Uso: tsx src/connect-github.ts "<Proyecto>" <owner/repo> [maxItems]
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

async function main(): Promise<void> {
  const project = process.argv[2];
  const repo = process.argv[3];
  const max = Number(process.argv[4] ?? "100");
  if (!project || !repo) {
    console.error('Uso: tsx src/connect-github.ts "<Proyecto>" <owner/repo> [maxItems]');
    process.exitCode = 1;
    return;
  }

  console.log(`Conectando GitHub ${repo} → "${project}"...`);
  const prs = JSON.parse(
    gh(["pr", "list", "-R", repo, "--state", "all", "--limit", String(max),
        "--json", "number,title,body,state,mergedAt,author,labels,url"]),
  ) as PR[];
  const issues = JSON.parse(
    gh(["issue", "list", "-R", repo, "--state", "all", "--limit", String(max),
        "--json", "number,title,body,state,labels,url"]),
  ) as Issue[];
  console.log(`  ${prs.length} PRs, ${issues.length} issues.`);

  let done = 0;
  for (const pr of prs) {
    const labels = (pr.labels ?? []).map((l) => l.name);
    const header = `[GitHub PR #${pr.number} · ${pr.state}${pr.mergedAt ? " (merged)" : ""} · ${repo}]`;
    const content = `${header}\n${pr.title}\n\n${(pr.body ?? "").slice(0, 4000)}`.trim();
    await saveContext({
      content,
      project,
      title: pr.title.slice(0, 120),
      type: "pr_summary",
      confidence: pr.mergedAt ? "high" : "medium",
      sourceType: "github_pr",
      sourceReference: `${repo}#${pr.number}`,
      createdBy: "ingest:github",
      metadata: { source: "github", kind: "pr", number: pr.number, state: pr.state, url: pr.url, author: pr.author?.login, labels },
    });
    done++;
  }
  for (const it of issues) {
    const labels = (it.labels ?? []).map((l) => l.name);
    const header = `[GitHub issue #${it.number} · ${it.state} · ${repo}]`;
    const content = `${header}\n${it.title}\n\n${(it.body ?? "").slice(0, 4000)}`.trim();
    await saveContext({
      content,
      project,
      title: it.title.slice(0, 120),
      type: it.state.toLowerCase() === "closed" ? "ticket_resolution" : "incident",
      sourceType: "github_issue",
      sourceReference: `${repo}#${it.number}`,
      createdBy: "ingest:github",
      metadata: { source: "github", kind: "issue", number: it.number, state: it.state, url: it.url, labels },
    });
    done++;
  }
  console.log(`Conector GitHub: ${done} items ingeridos.`);
}

main()
  .catch((e) => {
    console.error("Error en conector GitHub:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
