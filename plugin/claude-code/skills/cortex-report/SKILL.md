---
name: cortex-report
description: >-
  Report a Cortex bug as an issue on its own GitHub repo (Dinacode-Labs/cortex). Use it
  when the user says "report this", "open an issue", "this is a Cortex bug", or when a
  reproducible failure of the CLI, the MCP, the API, the web UI or the hooks shows up
  while working. Gather the diagnosis, SCRUB anything sensitive (the repo is public) and
  open the issue with `gh` once the user confirms.
---

# Report a Cortex bug to its GitHub

Target repo: **`Dinacode-Labs/cortex`** — it is **public**. Anything you write in an issue
gets indexed and cannot really be taken back. Scrubbing is not an optional step.

## When

Yes:
- A reproducible Cortex failure: CLI (`cortex …`), MCP tools, API, web UI, hooks,
  migrations or the operator commands (`cortex-admin …`).
- Behaviour that contradicts `README.md`, `docs/how-it-works.md` or `CLAUDE.md`.
- A concrete improvement with a real use case behind it (not loose ideas).

No:
- Failures of the user's own project that merely uses Cortex → those go to **their** repo.
- Usage questions → answer them; if a real documentation gap remains, open an issue with
  the `documentation` label.
- Something you cannot reproduce or narrow down → ask the user for the steps before
  opening anything.

## 1. Preflight

```bash
gh auth status
gh issue list --repo Dinacode-Labs/cortex --state all --search "<keywords>" --limit 10
gh label list --repo Dinacode-Labs/cortex
```

If `gh` is not authenticated, tell the user to run `gh auth login` (it needs the `repo`
scope) and stop here. If an existing issue already covers the failure, **do not open
another one**: propose commenting on it with the new data.

`gh issue create` fails if you pass a label that does not exist, so only use the ones
`gh label list` returns. Today the useful ones are `bug`, `enhancement`, `documentation`
and `question`.

## 2. Diagnosis

Run this in the Cortex repo, not in the user's one:

```bash
git -C <cortex-repo> log -1 --format='%h %ad %s' --date=short
git -C <cortex-repo> status --porcelain | wc -l
node -v && pnpm -v && uname -sr
```

A dirty tree (the second command returning more than 0) belongs in the issue: it changes
what a third party can reproduce. Add the evidence that matches where it fails:

| Where it fails | Evidence |
|---|---|
| CLI / hooks | exact command, output, exit code |
| MCP | tool name, arguments (scrubbed), error returned |
| API / web UI | route, method, status, browser console error |
| DB / migrations | the specific migration, the Postgres error |
| Install / setup | `cortex doctor` |
| Tests / types | `pnpm typecheck`, `pnpm test` (or `pnpm test:integration` with `pnpm db:up`) |

## 3. Write the issue

Title: `[<area>] <one-line symptom>`, area in lowercase — `core`, `agents`, `database`,
`embeddings`, `shared`, `client`, `mcp-server`, `server`, `web`, `cli`, `admin`, `plugin`,
`docs`.

Body:

~~~~markdown
## What happens
<1-3 sentences: observable symptom, no cause theories unless you verified them>

## Steps to reproduce
1. …
2. …

## Expected vs. actual
- Expected: …
- Actual: …

## Environment
- Commit: `<sha>` (`main`, clean/dirty tree)
- Node <x> · pnpm <y> · <OS>
- Area: <package or app>

## Evidence
```
<output or trace, scrubbed>
```

## Notes
<cause hypothesis marked as a hypothesis, workaround applied, or "none">
~~~~

Keep what you verified apart from what you assume: if you have not confirmed the cause,
say so as a hypothesis. Do not turn inferences into facts (the repo's traceability
principle).

## 4. Scrub — the repo is public

Go over the whole draft and **remove**:

- `.env` contents and any key: `sk-…`, `gho_…`, model and embedding API tokens,
  `DATABASE_URL` with user and password, session cookies, OTP codes.
- **Memory data from real projects**: client names, commercial decisions, contract
  constraints, context-pack entries, identifiable project slugs. If you need an example,
  use the demo project **Acme Portal** (`pnpm db:seed`) or made-up data.
- Emails and names of colleagues (including the ones from `git log`).
- Absolute paths with the username: `/home/<user>/Projects/…` → `<repo>/…`.
- Internal deployment URLs and database hosts.

Read traces **line by line**: they tend to drag along query params with tokens and
payloads with client content.

> If the failure cannot be described without sensitive data, **do not open the issue**.
> Say so to the user and offer either describing it in the abstract (symptom + area,
> without the data) or taking it to the internal tracker.

## 5. Confirm before publishing

Show the user the title, the final body and the labels, and **wait for an explicit OK**.
Opening an issue means publishing in a public repo: never do it on your own initiative.

## 6. Create the issue

Write the body to a temporary file (it avoids escaping trouble with backticks and `$`):

```bash
gh issue create \
  --repo Dinacode-Labs/cortex \
  --title "[cli] …" \
  --body-file <scratchpad>/issue.md \
  --label bug
```

Return the URL to the user.

## 7. Close the loop

If the failure taught the project something worth remembering (a resolved incident, a
workaround, a confirmed cause), capture it in Cortex with `save_project_context`
(`type: "incident"`, `sourceReference: "<issue URL>"`) — see the `cortex-capture` skill.
