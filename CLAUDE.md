# CLAUDE.md — Cortex

A guide for the AI agents (Claude Code and the like) that work on this repo.

## What this is

Cortex is a **context memory for software projects**. It captures knowledge (decisions,
constraints, incidents, conventions…), structures it and exposes it to people and to AI agents
through an authenticated MCP and a set of hooks that close the loop: the agent starts out
knowing the project and, when it finishes, what it learned goes back into the memory.

It deploys as a server (Docker) and is used through a CLI installed from npm. No laptop needs
a database or a model key.

> The whole approach is a **hypothesis to be validated**. Before taking anything as settled,
> question it and leave a record in `docs/decisions.md`.
>
> **Nothing corporate in this repo** (ADR-0026): no clients by name, no people as owners, no
> skills for internal tooling, no branding. That lives in the private `Dinacode-Labs/ai-toolbelt`
> repo.

## Stack (see `docs/decisions.md` for the why)

- A pnpm **monorepo** (`packages/*` libraries, `apps/*` executables).
- **TypeScript** + ESM (`NodeNext`), Node ≥ 20. In dev it runs with `tsx` over the sources (the
  `development` condition in `exports`); in production, `tsc -b` → `dist/`.
- **Postgres 16 + pgvector** as the single database (documental + vectorial + relational).
- **Mastra** for the individual agents (classify/enrich/rerank/synthesize/distill through
  `runAgent`). Its *workflows* were evaluated and **not** adopted for capture (see the ADR in
  `docs/decisions.md`); capture goes through `core`'s deterministic route.
- **MCP** (the official TS SDK) as the interface towards Claude Code / Codex / ChatGPT.
- Embeddings and LLM are **pluggable** through a generic `openai-compatible` provider (NaN by
  default at Dinacode; Ollama/vLLM/LM Studio work for on-prem), with a local fallback that
  needs no API keys. See ADR-0024; `nan` remains as a deprecated alias until 0.2.0.

## Structure

```
packages/
  shared/      # domain types, enums, zod v3 schemas, API contracts, env, branding
  client/      # client side: HTTP + credentials + .cortex.json + transcripts (→ shared only)
  database/    # SQL schema + migrations + Postgres client
  embeddings/  # pluggable provider (local | openai-compatible | openai | voyage)
  core/        # the domain: save/search/context-pack, dedup/reconciliation, lint,
               # bi-temporal, projects/permissions, extract, code indexing
  agents/      # the LLM layer (Mastra over an OpenAI-compatible endpoint): classifier, graph,
               # rerank, synthesize, distill, reconcile, maintain
apps/
  mcp-server/  # the MCP server with the 8 tools (stdio + authenticated Streamable HTTP)
  server/      # HTTP API + email/OTP auth (Hono) — the CLI, the hooks and the connectors use it
  web/         # the web UI (Hono SSR, session cookie): src/routes/ + views/ (hono/html,
               # autoescaped) + middleware/ + public/ (static files). It revolves around the
               # project: `/` lists projects and `/p/<slug>/…` are its sections (ADR-0050).
               # READ `docs/design.md` before touching it: it says what the UI is for and what
               # it is not, and it stops screens nobody can use from coming back
  cli/         # the DEVELOPER `cortex` CLI (auth, link, ui, setup, toolbelt, doctor, hooks,
               # `mem`, `mcp`). Lightweight: it depends on client+shared only, so it can be
               # installed with npm i -g.
               # `cortex mcp` (src/mcp/) proxies stdio → the server's HTTP MCP: that is how
               # agents use the tools with the user's permissions
  admin/       # `cortex-admin`: OPERATOR commands (migrate, maintain, ingest, heavy
               # connectors, services). It lives in the image, not on the laptop
scripts/       # install.sh (the remote installer; apps/server serves it)
plugin/        # claude-code/: what Cortex installs into Claude Code (hooks, MCP, the
               # cortex-capture skill, /cortex-save). The marketplace is declared in
               # .claude-plugin/marketplace.json, at the root (ADR-0032)
config/        # only the schema of the THIRD-PARTY registry (the organisation's toolbelt,
               # ADR-0014/0026). The product's own no longer lives here: it is in plugin/
tests/         # unit + integration (a real Postgres; see CONTRIBUTING.md)
docs/
  decisions.md # a light ADR log: decisions = hypotheses to revisit
  design.md    # what the web UI is for and what it is not; read it BEFORE touching apps/web
  roadmap.md   # what is missing (the technical WHAT only; priorities and owners stay out)
  research/    # technical research of general interest
  toolbelt-registry.md
```

> **What does NOT go in this repo** (ADR-0031): operational decisions (which provider, with
> which key, at what cost), security audits and refactor plans with findings per file, business
> priorities and owners, and client data (ADR-0026). All of that lives in the private
> `Dinacode-Labs/ai-toolbelt` repo. Quick rule: if it helps somebody outside use, understand or
> improve Cortex, it is public; if it describes how we operate it, it is private.

`@cortex/core` is deterministic (no LLM). The intelligence layer (`@cortex/agents`, Mastra over
an OpenAI-compatible endpoint) is injected from each entrypoint by calling `wireLlm()` after
`loadEnv()` (it wires `setClassifier`/`setReranker`/`setReconciler` and the embeddings usage
sink; with no `LLM_PROVIDER`, core falls back to heuristics). MCP, the API, the UI and the CLI
all consume `core`. Note: `agents` uses zod v4 (Mastra requires it), isolated from the zod v3
the rest of the repo uses; do not cross schemas between the two.

## Dependency rules (what may import what)

```
shared      → (no internal dependencies)      # types, API contracts, pure utilities
client      → shared                          # client side: HTTP, credentials, transcripts
database    → shared
embeddings  → shared
core        → client, database, embeddings, shared   # no LLM; from client, only .cortex.json
agents      → client, core, database, shared         # it implements core's LLM hooks
apps/*      → any package
```

- Packages **never** import from `apps/*`, nor another package's files by path.
- Side effects (`loadEnv`, wiring hooks, `serve`, `process.exit`) belong **only** in
  entrypoints, never at import time in a library module.
- These rules **hold** today: the multimodal LLM layer is injected with `setMediaExtractor`,
  just like the classifier, the reranker and the reconciler. Do not add exceptions.
- **`apps/cli` may depend only on `client` and `shared`.** If a command needs the database, the
  model or to stand up a service, it goes in `apps/admin`. There is a test for it
  (`tests/client-package.test.ts`).
- **`client` is kept lightweight on purpose**: no Postgres, no Mastra, no embeddings. That is
  what allows the CLI to be packaged and distributed with `npm i -g` without dragging ~95 MB of
  dependencies onto every dev's laptop (ADR-0025). There is a test for it
  (`tests/client-package.test.ts`), because it is an easy rule to break without noticing.

## Discipline

One PR per change, `typecheck` and tests green, docs updated in the same PR, and no
"while-I-am-here" fixes outside the scope. If you find something broken that is not yours to
touch, note it in the PR and move on.

## Commands

```bash
pnpm install            # install dependencies
pnpm db:up              # start Postgres (Docker, host port 5433)
pnpm db:migrate         # apply migrations
pnpm db:seed            # load the demo data (the fictional Acme Portal project)
pnpm typecheck          # check types across every package (no build)
pnpm build              # tsc -b: compiles packages/* and the apps to dist/
pnpm cortex <cmd>       # the developer CLI (auth, link, hooks…)
pnpm admin <cmd>        # operator commands (migrate, maintain, ingest…)
pnpm clean              # deletes the dist/ directories and the .tsbuildinfo files
pnpm test               # unit tests (Vitest, no database)
pnpm test:integration   # integration tests (needs pnpm db:up)
pnpm --filter @dinacodelabs/cortex build   # bundles the CLI (tsup) → apps/cli/dist/cortex.js
```

Copy `.env.example` to `.env` before starting. By default everything works **with no keys**
(`local` embeddings, not semantic); connect a real endpoint (`openai-compatible` with NaN, or
OpenAI/Voyage) when you want genuine quality.

## Conventions

- Language: **the repository is in English — all of it**. That includes CLI messages, MCP tool
  descriptions, the skill and the plugin's commands, API errors, the web UI, `README.md`,
  `docs/how-it-works.md`, `CONTRIBUTING.md` and `SECURITY.md`, and equally the code comments,
  the ADRs (`docs/decisions.md`), the roadmap, the research notes and the LLM agents' prompts.
  The repository is public, and a repo that switches language halfway is a repo half of which
  nobody outside can read — including the comments that explain the decisions worth reading.

  Two things stay in Spanish, and both are **data, not prose we wrote**:
  - **Patterns that match the corpus**, which is Spanish: `CLASSIFY_RULES`, `MODULE_KEYWORDS`
    and `polarityTags` in `packages/core/src/text.ts`, the deictics regex in
    `packages/shared/src/domain.ts`, and the eval fixtures in `tests/fixtures/eval/` (the
    baseline was measured against them). They match what users write, not the language of the
    file they live in.
  - The **output language** of the LLM agents (`OUTPUT_LANGUAGE` in
    `packages/agents/src/mastra.ts`). The prompts themselves are in English; what the agents
    produce is knowledge entries stored next to a corpus that is already Spanish, so changing
    it is a product decision, not a translation.

  Anything an external system owns keeps its own spelling too (Plane's `'Histórico'`, Notion's
  property names, migration filenames — they are primary keys in `schema_migrations`). Each of
  these carries an English comment saying why.

  Since we are Spanish speakers, the two entry points are also kept in Spanish —
  `README.es.md` and `CONTRIBUTING.es.md` — and English is the version that must be current
  when the two disagree.
- No secrets in the repo. `.env` is ignored; use `.env.example` as the template.
- **One client can talk to several servers** (ADR-0033). The server comes from the repo's
  `.cortex.json`, not from a global variable: whoever is going to call the API from a folder has
  to go through `useProjectServer(cwd)` first. The token is looked up **per server**; do not
  assume `readCredentials()` with no argument is the right one.
- **The CLI and the server are not in lockstep** (ADR-0062). The contract is the HTTP API. If
  you add an endpoint or a field, the side that reads it tolerates its absence: an optional
  field, 404 = an old server, and it degrades instead of failing. `minClientVersion` is the only
  thing that blocks (writes only) and the operator raises it when something genuinely breaks.
  Version comparison lives in `apps/cli/src/version.ts` and the notice/block in
  `apps/cli/src/compat.ts`; the hooks and `cortex mcp` never call it (stdout is protocol; there
  is a test).
- **Scrubbing secrets**: `scrub()` lives in `@cortex/shared` (a pure function, no I/O). `agents`
  applies it before sending anything to the LLM and `core` applies it when persisting
  (`saveContext`, `captureBatch`): the server does not trust the client to have cleaned up. It
  is idempotent, so applying it at several layers is safe. If you add a way for text to come in,
  route it through one of those two points.
- Every unit of knowledge keeps its **source, date, author, confidence, status and validity**
  (the traceability principle, §5.5). Do not turn inferences into facts.

## Documentation: keep it alive (important)

Documentation is part of the work, not an extra. When behaviour changes, **update in the same
PR** whatever it affects: `README.md` (capabilities/architecture/commands/structure),
`docs/decisions.md` (an ADR: a decision is a hypothesis to revisit — add an entry for decisions
that carry weight), `docs/roadmap.md`, `CONTRIBUTING.md` and this `CLAUDE.md`.

- **Keep this `CLAUDE.md` up to date** when the stack, the structure or the conventions change,
  so the next agent is not working from stale information.
- **Prune it every now and then**: reread it and **clear out** whatever has gone out of date,
  become duplicated or stopped mattering. A short, truthful CLAUDE.md is worth more than a long,
  outdated one.
- Before claiming something "works like this", check the file/function/flag you are citing
  still exists (the code wins over the docs).
