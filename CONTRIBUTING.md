# Contributing to Cortex

Fixes, improvements and new capabilities arrive as **pull requests**. This guide explains how
the repository is put together and where each thing lives.

> **Nothing corporate in here.** Named clients, people as owners of work, internal tooling and
> brand material do **not** belong in this repository: they live in a separate private one
> (ADR-0026). In the docs a client is "a real project" or "Acme", and a task has no owner.
>
> **Nor how we run it** (ADR-0031): which provider we use with which key and at what cost,
> security audits, refactor plans with findings per file, business priorities. The product
> documents *how to configure it*, not *what our deployment is configured with*. Quick rule:
> if it helps somebody outside use, understand or improve Cortex, it is public; if it
> describes how we operate it, it is not. When in doubt, it is not.

## Getting started

```bash
pnpm install
cp .env.example .env          # embeddings/LLM; works with no keys at all in local mode
pnpm db:up && pnpm db:migrate # Postgres + pgvector (Docker) + schema
pnpm typecheck                # types across the monorepo — no build needed
pnpm build                    # optional in dev; required for Docker and production
```

**You do not need to compile in development**: everything runs with `tsx` straight off the
sources (`pnpm cortex`, `pnpm --filter @cortex/server dev`…). What makes that work is a
`development` condition in each package's `exports`, resolving to `src/` when the process is
launched with `--conditions=development` (the scripts do) and to `dist/` otherwise. That is
why `pnpm typecheck` and the tests work without ever having built.

**Production does compile**: `pnpm build` runs `tsc -b` over the project references and leaves
a `dist/` in every package and app; the Dockerfile starts `node dist/...`. If you touch how a
path to a data file is resolved — migrations, the web app's static files, `install.sh` —
build and check they still resolve. CI has a smoke test for exactly that, because it is the
failure that neither typecheck nor the tests catch.

`apps/cli` is deliberately outside `tsc -b`: it is bundled, so it can ship as an installable
CLI.

## Map of the repository

| If you want to… | Go to… |
| --- | --- |
| Domain operations (capture, search, pack, lint, projects, auth) | `packages/core/src/` — **deterministic, no LLM** |
| The LLM layer (classify, graph, rerank, synthesise, distil, merge, reconcile) | `packages/agents/src/` (Mastra agents) |
| The domain model (types, enums, zod schemas) | `packages/shared/src/domain.ts` |
| Schema, SQL, Postgres client | `packages/database/` (migrations in `migrations/`) |
| The embeddings provider | `packages/embeddings/` |
| MCP server · web UI · API and auth · CLI | `apps/mcp-server` · `apps/web` · `apps/server` · `apps/cli` |
| Client side (HTTP, credentials, `.cortex.json`, transcripts) | `packages/client/` — **no** Postgres, **no** LLM |
| A developer command (auth, link, hooks, mem) | `apps/cli/src/commands/` — only `client` + `shared` |
| An operator command (database, model, services) | `apps/admin/src/commands/` |
| What Cortex installs into Claude Code (hooks, MCP, skill, command) | `plugin/claude-code/` (+ `.claude-plugin/marketplace.json` at the root) |
| Per-agent integration (`cortex setup`) | `apps/cli/src/setup/` — one adapter per agent, plus `hooks-json.ts` and `legacy.ts` |
| Third-party registry (`cortex toolbelt`) | `config/toolbelt.json` (schema) + `apps/cli/src/toolbelt/` |
| Diagnostics (`cortex doctor`) | `apps/cli/src/commands/doctor.ts` |
| Packaging the CLI for npm | `apps/cli/tsup.config.ts` — the `@cortex/*` packages go inside the bundle |

**The dependency rule that matters:** `core` does **not** import `agents`, which would be a
cycle. The intelligence is **injected**: every entrypoint calls `wireLlm()` (from
`@cortex/agents`) after `loadEnv()`, wiring `setClassifier` / `setReranker` / `setReconciler`
and the embeddings usage sink. If an operation in core needs an LLM, define the hook in core
and wire it in `wire.ts`. The full table — which package may import which, where side effects
are allowed — is in [`CLAUDE.md`](./CLAUDE.md).

## Common recipes

- **Add an MCP, skill or command to the toolbelt** → if it belongs to **the product** (anyone
  deploying Cortex would use it), it goes in `config/toolbelt.json`. If it is **your
  organisation's** tool, it goes in your own external registry, not here (ADR-0026); the
  schema is in `docs/toolbelt-registry.md`. **Never** put credentials in it: declare the `env`
  it needs and it is skipped when missing (`--doctor` lists them).
- **Add a source connector** → `apps/cli/src/commands/connect-<x>.ts`, exporting `run(args)`.
  Reuse core's `extract` layer (multimodal) and write through the authenticated API
  (`/capture/batch`). Make it incremental by `sourceReference`. Register it in `COMMANDS`
  (`apps/cli/src/index.ts`).
- **Support a new file format** → `packages/core/src/extract.ts` (`SUPPORTED_EXTS` plus a
  branch in `extractFileText`). Every connector inherits it.
- **Change the schema** → a new migration in `packages/database/migrations/NNNN_desc.sql`,
  idempotent (`IF NOT EXISTS`). The runner applies unregistered ones in order.
- **Add an LLM agent role** → `AgentRole` + `INSTRUCTIONS` + the registration in
  `packages/agents/src/mastra.ts` (`JSON_ROLES` if it returns JSON).
- **Add a `cortex` subcommand** → create `apps/cli/src/commands/<cmd>.ts` exporting
  `run(args: string[])` — no `process.exit`, no side effects on import; the dispatcher owns
  the lifecycle — and register it in `COMMANDS`.

## Conventions

- **Language.** Anything an outsider reads is in **English**: the README, this guide, the
  security policy, CLI output, MCP tool descriptions, the web UI, and the code itself. The
  team's working record stays in **Spanish**: code comments, the decision records, the roadmap
  and the research notes. The prompts the LLM agents use are Spanish too, because the corpus
  they process is.
- **No secrets in the repository.** `.env` is ignored; use `.env.example`. Secrets are
  scrubbed before anything reaches an LLM and again before it is stored.
- **Traceability.** Every unit of knowledge keeps its source, date, author, confidence, status
  and validity. Do not turn inferences into facts — anything automatic gets low confidence.
- **zod is split:** `agents` uses **zod v4** (Mastra requires it); everything else uses **v3**.
  Do not pass schemas between them.
- **Quality:** `pnpm typecheck` and `pnpm test` must pass. Tests live in `tests/`:
  - **Unit** (`pnpm test`): pure, deterministic logic — auth and permissions, project linking
    and slugs, session parsers, schemas. No database, no network.
  - **Integration** (`pnpm test:integration`, in `tests/integration/`): against a real
    Postgres (`cortex_test`, `local` embeddings, no LLM). Needs `pnpm db:up`; the global setup
    creates and migrates the test database. Covers persistence and search, hierarchy and
    inheritance, permissions and cascades, batch capture, and auth.

  Add tests with your PR when you touch testable logic.

## Pull requests

1. Branch from `main`; keep the change focused.
2. `pnpm typecheck` green.
3. **Update the documentation you affected** (see below). A PR that changes behaviour without
   touching docs is unfinished.
4. In the PR: what changes, why, and how you verified it.

## Keeping the documentation alive

Documentation is part of the work, not an extra:

- **`README.md`** — capabilities, architecture, commands, layout.
- **`docs/decisions.md`** — lightweight ADRs: every decision is a **hypothesis to revisit**
  (the decision, why, and "revisit when…"). Add an entry when you make a decision that
  matters.
- **`docs/roadmap.md`** — what is left, and what was just done.
- **`docs/research/`** — the investigation behind decisions.
- **`CLAUDE.md`** — the guide for AI agents working on this repository. Keep it current, and
  prune it now and then so it does not drift into noise.

## Publishing a release

There is **one version for the whole monorepo**. With a single publishable artefact — the CLI
— and an image carrying everything else, versioning each package separately would be ceremony
without benefit, and nobody would know which version they had deployed.

```bash
pnpm version:set 0.2.0                       # root, packages, apps, plugin and CHANGELOG
git commit -am "chore(release): v0.2.0"
git tag v0.2.0 && git push origin main v0.2.0
```

The tag triggers the workflow, which checks that it matches what the `package.json` files say
and that the CHANGELOG has that section, runs everything (typecheck, tests, build), publishes
the image to GHCR, publishes `@dinacodelabs/cortex` to npm, and creates the Release from the
CHANGELOG notes.

**Every PR adds its line to `[Unreleased]`.** Write what changes for whoever uses it, not what
you did: the release notes come from there, not from the commits.

While we are on `0.x`, a **minor** release may break compatibility. Two things are already
marked for removal in `0.2.0`: the `LLM_PROVIDER=nan` alias and the `BREVO_SENDER` variable.

## This repository is public

What gets written here, anyone can read. Two things follow from that:

- **Say what was found, not how it was found.** A finding is worth what it teaches — "this
  pair of entries scores 0.86–0.88" — not the rig that produced it. The rig ages badly and
  helps nobody outside. There is a test watching for it (`tests/docs.test.ts`).
- **Nothing corporate, anywhere**: no named clients, no people as owners, no internal tooling.
  ADR-0031 draws the line; the quick rule is above.

The history from before the repository was opened is working material, not product: it is not
maintained, not cited, and not to be taken as current. What describes Cortex today is the tree
you are looking at and the decision records.
