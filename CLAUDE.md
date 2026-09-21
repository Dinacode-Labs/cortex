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

## Rules

What you have to respect when writing code here lives in `.claude/rules/`, one file per subject.
Claude Code loads them by itself, so **do not import them from here and do not duplicate their
content** (ADR-0065):

- Always: `architecture.md`, `language.md`, `tests.md`, `documentation.md`.
- Only when you touch what they cover (a `paths:` header): `typescript-style.md`, `api-http.md`,
  `cli.md`, `web.md`, `llm-agents.md`, `evals.md`.

If you work with another agent that does not read `.claude/rules/`, those files are still the
reference: they are written for anyone.

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
evals/         # the eval sets: retrieval/ (corpus + questions) and distill/<lang>/ (windows +
               # gold). NOT tests: they mark a model, need a provider and are launched by hand,
               # so they live outside tests/ and CI never runs them (.claude/rules/evals.md)
docs/
  decisions.md # a light ADR log: decisions = hypotheses to revisit
  design.md    # what the web UI is for and what it is not; read it BEFORE touching apps/web
  roadmap.md   # what is missing (the technical WHAT only; priorities and owners stay out)
  research/    # technical research of general interest
  toolbelt-registry.md
```

`@cortex/core` is deterministic (no LLM): the intelligence layer is **injected** from each
entrypoint through `wireLlm()`. How and why, in `.claude/rules/architecture.md`.

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

## Keeping this alive

Update this document and `.claude/rules/` when the stack, the structure or a convention changes, so
the next agent is not working from stale information. And **prune them**: a short, truthful
CLAUDE.md is worth more than a long, outdated one.
