---
name: cortex-report
description: >-
  Report a Cortex bug as an issue on its own GitHub repo (Dinacode-Labs/cortex). Use it when
  the user asks for it: "report this", "open an issue", "is this a Cortex bug?". Gather the
  diagnosis, SCRUB anything sensitive (the repo is public) and open the issue with `gh` once
  the user confirms. If a Cortex failure shows up while you are working on something else,
  do not start this on your own: offer to report it in one line and wait for a yes.
---

# Report a Cortex bug to its GitHub

Target repo: **`Dinacode-Labs/cortex`** — it is **public**. Anything you write in an issue
gets indexed and cannot really be taken back. Scrubbing is not an optional step.

## When

The user starts this, not you. If you trip over a Cortex failure while doing something else,
say it in one line — *"this looks like a Cortex bug; want me to report it?"* — and go back to
what you were doing. Do not gather evidence or write a draft until they say yes: a report
nobody asked for costs the user a review of 60 lines to throw away.

Once they say yes, report:
- A reproducible Cortex failure: CLI (`cortex …`), MCP tools, API, web UI, hooks,
  migrations or the operator commands (`cortex-admin …`).
- Behaviour that contradicts `README.md`, `docs/how-it-works.md` or `CLAUDE.md`.
- A concrete improvement with a real use case behind it (not loose ideas).

Do not report:
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

For `<keywords>`, search **the literal error text, quoted**, plus the area — `"Project not
found" cli`. Searching your reading of the failure ("slug resolution") finds nothing, because
whoever reported it first pasted the message, not their theory. Try the message alone too.

If `gh` is not authenticated, tell the user to run `gh auth login` (it needs the `repo`
scope) and stop here. If an existing issue already covers the failure, **do not open
another one**: propose commenting on it with the new data.

`gh issue create` fails if you pass a label that does not exist, so only use the ones
`gh label list` returns. Today the useful ones are `bug`, `enhancement`, `documentation`
and `question`.

## 2. Diagnosis

**Paste the evidence verbatim from the session — never retyped from memory.** A paraphrased
trace looks exactly as good as a real one and sends whoever picks up the issue somewhere
else.

Versions, the case that applies to almost everyone (Cortex installed from npm, no clone of
this repo on disk):

```bash
cortex version            # CLI, node and server version — it also prints the server URL
claude plugin list        # version of the cortex@dinacode-cortex plugin
```

Only if the user is **developing Cortex from a clone of the repo**, the commit matters and
so does the state of the tree:

```bash
git -C <cortex-repo> log -1 --format='%h %ad %s' --date=short
git -C <cortex-repo> status --porcelain | wc -l
pnpm -v
```

A dirty tree (the second command returning more than 0) belongs in the issue: it changes
what a third party can reproduce. Add the evidence that matches where it fails:

| Where it fails | Evidence |
|---|---|
| CLI / hooks | exact command, output, exit code |
| MCP | tool name, arguments (scrubbed), error returned |
| API / web UI | route, method, status, browser console error |
| DB / migrations | the specific migration, the Postgres error |
| Install / setup | `cortex doctor` **with the detail of the `Session`, `Server`, `MCP` and `This folder` lines redacted** — they carry the user's email, the server URL and the real project slug. Keep the check names and their ✔/!/✗ status, which is what diagnoses anything |
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
- cortex `<cli version>` · server `<server version>` · plugin `<plugin version>`
- Node <x> · <OS>
- Area: <package or app>
- Commit: `<sha>` (`main`, clean/dirty tree)   <- only from a clone of the repo; drop this line otherwise

## Evidence
```
<output or trace, pasted verbatim and scrubbed>
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
- The lines of the commands you were asked to run for evidence: the `Session`, `Server`,
  `MCP` and `This folder` details of `cortex doctor` (email, server URL, project slug — and
  with more than one session, the check names carry the server host too), and the
  `server …` line of `cortex version`. Its version number is the part worth reporting; the
  URL is not.
- Absolute paths: they carry the username **and often the client's name as a folder**
  (`/home/<user>/clients/<Client>/api`, `/Users/<user>/…`) → replace with `<repo>/…`.
- Internal deployment URLs and database hosts.

Read traces **line by line**: they tend to drag along query params with tokens and
payloads with client content.

Then, before showing anything, write a **`Scrub report`**: one line per item of this list
with what you took out.

```
Scrub report
- keys/tokens: none found
- project memory: 2 (client name in the pack entry)
- emails: 1 (git author)
- doctor/version lines: 3 (Session, MCP, server URL)
- absolute paths: 3
- deployment URLs: none found
```

If every line says "none found" on a trace longer than a few lines, look again: it is far
more likely that you missed something than that there was nothing.

> If the failure cannot be described without sensitive data, **do not open the issue**.
> Say so to the user and offer either describing it in the abstract (symptom + area,
> without the data) or taking it to the internal tracker.

## 5. Confirm before publishing

Show the user the title, the **scrub report**, the final body and the labels, and **wait for
an explicit OK**. The scrub report goes with it so their OK covers what you removed and not
only what is left: auditing 60 lines of trace for what is missing is not something anyone
can do in the two seconds this actually gets.

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

The issue is already the record of the bug, so most of the time nothing else gets saved.
Capture it in the user's project **only if that project has to do something about it**: a
workaround it now applies, a version it cannot upgrade to yet, a step of its setup that
has to change. "The Cortex MCP returns 500 on save" is not memory of the project the user
was working on — it is noise in its context pack.

When it does apply, save it with `save_project_context` (`type: "incident"`,
`sourceReference: "<issue URL>"`) **in the project the user is working on**, describing the
workaround, not the bug — see the `cortex-capture` skill.
