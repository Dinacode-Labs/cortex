<img src="docs/brand/mark.svg" width="64" height="64" alt="" align="left">

# Cortex

[![CI](https://github.com/Dinacode-Labs/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/Dinacode-Labs/cortex/actions/workflows/ci.yml)

*En español: [`README.es.md`](./README.es.md).*

**Project memory for software teams.** Cortex captures the knowledge that gets scattered
across a project, the decisions, constraints, incidents, conventions, pull requests,
conversations, docs and code, structures it in a hybrid layer that is at once documental,
vectorial, a graph and bi-temporal, and serves it to people and to AI coding agents.

The agents get it through an authenticated MCP server and a pair of hooks that close the
loop: your agent **starts** a session already knowing the project, and when the session ends
Cortex **captures** what was learned, signed with your email.

You deploy a server and install a CLI from npm. No laptop needs a database or a model key:
the distillation runs on the server.

Apache-2.0. Found a vulnerability? See [`SECURITY.md`](./SECURITY.md).

- Decisions (ADRs): [`docs/decisions.md`](./docs/decisions.md) · Roadmap: [`docs/roadmap.md`](./docs/roadmap.md)
- Web UI design: [`docs/design.md`](./docs/design.md) — what the interface is for, and what it is not
- Contributing: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- **[How Cortex works](./docs/how-it-works.md)**, a guide to the internals from first
  principles. What an embedding is, what RAG is, what a knowledge graph buys you, what each
  AI agent does. No prior experience needed. It is written so that you can judge whether
  Cortex works well and where it should be improved, so every concept comes with its real
  limits, not a sales pitch.

---

## Contents

- [Try it on your machine](#try-it-on-your-machine)
- [For developers](#for-developers) · [Let your agent install it](#or-let-your-agent-do-it)
- [What it does](#what-it-does) · [Architecture](#architecture)
- [The 8 MCP tools](#the-8-mcp-tools) · [How Cortex reaches your agents](#how-cortex-reaches-your-agents) · [Connectors](#ingesting-sources-connectors)
- [Running the server](#running-the-server) · [Repository layout](#repository-layout)

---

## Try it on your machine

Before setting anything up for your team, you can run a whole Cortex locally. All you need is
Docker.

```bash
curl -fsSL https://raw.githubusercontent.com/Dinacode-Labs/cortex/main/deploy/local.yml -o cortex-local.yml
docker compose -f cortex-local.yml up -d
npm install -g @dinacodelabs/cortex
cortex auth login --server http://localhost:8787
```

The sign-in code is not emailed anywhere. It is printed to the server log:

```bash
docker compose -f cortex-local.yml logs server | grep -oE '[0-9]{6}' | tail -1
```

That is it:

```bash
cortex link --create "My Project"   # in whatever repository you like
cortex setup --all                  # wire up your agents
cortex doctor                       # check every piece is in place
```

Everything listens on `127.0.0.1` only, the data survives a restart, and
`docker compose -f cortex-local.yml down -v` removes it without a trace.

**What works with no keys at all:** the 8 MCP tools, saving, searching, context packs, lint,
and the web UI on `localhost:8080`.

**What needs a model:** automatic session capture. Distilling a conversation into pieces of
knowledge is exactly the job of the LLM, so without one the hooks produce nothing. Giving it
a model does not mean editing the file:

```bash
# Ollama, already running on your machine
LLM_PROVIDER=openai-compatible LLM_ALLOW_NO_KEY=1 LLM_MODEL=llama3.1 \
  LLM_BASE_URL=http://host.docker.internal:11434/v1 \
  docker compose -f cortex-local.yml up -d

# or any OpenAI-compatible endpoint
LLM_PROVIDER=openai-compatible LLM_BASE_URL=https://… LLM_API_KEY=… LLM_MODEL=… \
  docker compose -f cortex-local.yml up -d
```

The default embeddings are local and **not** semantic. They exist so the thing starts without
keys, not so you can judge search quality. For that, point `EMBEDDINGS_*` at a real endpoint.

This is **not** a production deployment. No TLS, no backups, no limit on who can sign up.
That is [`deploy/README.md`](./deploy/README.md).

## For developers

One command installs the `cortex` CLI and signs you in with an email and a code:

```bash
curl -fsSL https://<your-cortex-server>/install.sh | sh
```

Or directly, if you already have Node 20 or newer:

```bash
npm install -g @dinacodelabs/cortex
cortex auth login --server https://<your-cortex-server>
```

Then wire up your agents. This is a separate step on purpose: you can repeat it whenever you
like without reinstalling anything.

```bash
cortex setup --all       # Claude Code, Codex, OpenCode, Hermes, Pi, whichever you have
cortex setup --status    # what is installed, and where
cortex setup --dry-run   # show the plan without writing
```

What it does in each one:

| Agent | How it integrates | Context on start | Capture on end |
| --- | --- | --- | --- |
| Claude Code | the `cortex` plugin, or hooks in `settings.json` if you cannot install it | ✓ | ✓ |
| Codex | the same plugin, plus `codex mcp add` | ✓ | ✓ |
| OpenCode | a JS plugin and an MCP entry in `opencode.json` | ✓ | ✓ |
| Pi | an extension in `~/.pi/agent/extensions`, plus MCP | ✓ | ✓ |
| Hermes | hooks and MCP in `config.yaml` | ✓ | ✓ |

**In Pi, the memory is also four tools** — `cortex.mem_save`, `cortex.mem_search`,
`cortex.mem_get_observation` and `cortex.mem_update` — on top of the MCP. The `cortex.` prefix
is deliberate: Pi keeps the *first* extension that registers a given name and does so silently,
so a bare `mem_save` would have made another memory extension's tools unreachable without a
word. Prefixed, both coexist, and harnesses that look for a memory tool still find this one
(ADR-0034).

If you are coming from the old install, the one that cloned the repository, `setup` migrates
it: old hooks are replaced in place, the MCP is re-registered against the server, and the
shim is removed from your PATH.

Two things to expect the first time: **Codex asks you to trust the plugin hooks**, and
**Hermes asks permission for shell hooks**. Both are one-off and both are the agent doing the
right thing.

Then, in any repository you work in:

```bash
cortex link --create "My Project"   # create the project and link this folder (.cortex.json)
cortex link <slug>                  # link to a project that ALREADY exists, if you have access
cortex ui                           # open the web UI, already signed in
cortex doctor                       # when something is off: which piece failed, and how to fix it
cortex --help                       # every command
```

The memory is also reachable straight from the terminal, without an agent in the middle:

```bash
cortex mem search "why did we drop the queue"   # add --all to search every project you can see
cortex mem save "We cap uploads at 25MB (Caddy)" --title "Upload limit" --type constraint
cortex mem get <id>                             # one entry in full, with where it came from
cortex mem update <id> --content "…"            # fix something you got wrong
```

**What you get without doing anything else:** when you open a session, Cortex **injects** the
project's context pack. When you close it, Cortex **captures** what was learned, distilled
rather than raw, signed with your email. The 8 tools are there to query the project's memory
at any point in between.

- **Opt-in per repository.** With no `.cortex.json`, nothing is injected and nothing is
  captured. `cortex link --ignore` switches off one specific repository, a personal one
  nested inside a linked tree, for instance.
- **Linking to something that exists.** The slug is the identity. If you run `--create` and
  the slug is taken, **no duplicate is created**: you get linked if you have access, or told
  to ask an administrator if the project is private. Nothing is created either way.
- **Permissions.** Projects are **public** by default. `--private` restricts one to its owner
  and members. `--parent <slug>` hangs it under a client, inheriting context and permissions.
  In the UI you see the projects you can reach; an **admin** sees them all and manages
  membership of the private ones.
- All you need is a **Cortex server running somewhere**. Whoever handles your infrastructure
  runs it.
- **Two clocks, compared rather than tied.** You update the CLI from npm; an operator updates
  the server. They do not have to match ([ADR-0062](./docs/decisions.md#adr-0062)). When the
  server is newer, commands end with one line on stderr, once a day: `Cortex 0.1.9 → 0.1.12 ·
  cortex upgrade`. When your CLI is newer, they tell you the server is behind so you can tell
  whoever runs it. Only if your CLI is older than the server's `minClientVersion` do the
  commands that **write** refuse; reading keeps working. `CORTEX_NO_VERSION_CHECK=1` turns it
  off. Hooks and `cortex mcp` never print any of this.

### Or let your agent do it

Paste this into Claude Code, Codex, or whatever you use. It does everything except the one
step it cannot do for you.

```text
Set up Cortex on this machine. Run the commands, do not explain them to me.

1. Check that Node is 20 or newer. If it is not, stop and tell me how to upgrade it.
2. Install the CLI:  npm install -g @dinacodelabs/cortex
3. Sign me in:  cortex auth login --server <SERVER URL>
   It asks for my work email and then a code that arrives by email. You cannot read my
   inbox, so print the prompt and wait for me to type the code.
4. Wire up my agents:  cortex setup --all
   It is idempotent and backs up anything it touches. If I came from an older install, it
   migrates it.
5. If this folder is a project I work on, ask me the project name and link it:
   cortex link --create "<name>"      Do not invent a name.
6. Check it worked:  cortex doctor
   Tell me what it reports. If something is not green, say which piece and why.

If a step fails, stop and show me the error. Do not work around it.
```

For a machine that is already set up, connecting one more repository is shorter:

```text
Link this repository to Cortex so my sessions are remembered.

Run `cortex link` first to see which projects I can reach. If one of them is obviously this
repository, link to it with `cortex link <slug>`. If none fits, ask me for a name before
creating anything. Then run `cortex doctor` and tell me if this folder is linked.
```

### Working with more than one Cortex

If you work for several organisations, each with its own Cortex, you can be signed in to all
of them at once. **The server is a property of the repository**, so you never have to remember
which one you are in: you decided it when you linked the folder.

```bash
cortex auth login --server https://cortex.client-a.com    # signing in to one does not sign you out of the other
cortex link --create "Their Project" --server https://cortex.client-a.com
cortex auth status                                        # every session, checked against its own server
cortex auth use https://cortex.client-a.com               # change which one is the default
```

The server lands in that repository's `.cortex.json`, and from then on the hooks, the CLI and
the MCP all follow it. With more than one session, `cortex link --create` **refuses** to run
without `--server`. Creating a client's project on another client's server is not the kind of
mistake you notice later.

## What it does

- **The automatic loop.** Context injected when a session opens, capture when it closes,
  across five agents, installed by `cortex setup`. Capture **reconciles** rather than appends,
  in the style of mem0: add, update, supersede or no-op. Everything is attributed to a person,
  and `maintain` heals the memory over time, promoting what gets corroborated and letting
  what is dead decay.
- **Hybrid search.** Vector similarity with pgvector plus lexical full-text search, fused with
  Reciprocal Rank Fusion, with an optional LLM rerank on top.
- **A knowledge graph.** Entities and relations extracted by an LLM, with variant resolution
  and a visualisation.
- **Bi-temporal.** Every fact has a validity period. What becomes obsolete is **invalidated,
  not deleted**, so you can ask what the project knew on a given date.
- **Context packs and Q&A.** A briefing per project or area, and answers with citations.
  Sub-projects **inherit** from their parent.
- **Multimodal ingestion.** One `extract` layer for plain text and Markdown, Word, PDF and
  Excel, `.drawio` diagrams, images captioned by a vision model, and audio and video
  transcribed with whisper and ffmpeg.
- **Identity and governance.** Sign-in by email and one-time code, no passwords. Admins by
  environment variable, public and private projects, a client to sub-project hierarchy, and
  `created_by` on every entry.
- **Knowledge lint**, **code indexing**, and **AI observability** with cost, tokens and
  tracing.
- **An authenticated MCP** with 8 tools that apply the caller's permissions, usable from any
  agent that speaks MCP. `cortex mcp` bridges stdio to it.
- **Ready for production.** A compiled image, TLS, real healthchecks, and backups whose
  restore path has actually been tested ([`deploy/README.md`](./deploy/README.md)).

## Architecture

```
Claude Code / Codex / OpenCode / Hermes / Pi
   │ (MCP, 8 tools)   │ (hooks: inject context / auto-capture)    │ (cortex CLI)
   ▼                  ▼                                           ▼
 apps/mcp-server    apps/server (HTTP API + email/OTP auth)  apps/web (UI, cookie auth)
        │                 │   ▲  hooks and connectors write through the authenticated
        └────────┬────────┘   │  API (attribution + permissions), never straight to the DB
                 ▼            api-client
        packages/core  (@cortex/core)   ── deterministic domain: capture, hybrid search,
                 │   ▲                       context packs, lint, bi-temporal, reconciliation,
                 │   │ setClassifier/        projects, slugs, permissions, hierarchy, auth,
                 │   │ setReranker/          multimodal extract, batch capture
                 │   │ setReconciler
                 │   └── packages/agents (@cortex/agents) ── Mastra agents: classifier,
                 │           graph, reranker, retriever, distiller, merger, reconciler, maintain
                 ├── packages/embeddings (local | openai-compatible | openai | voyage)
                 └── packages/database (Postgres + pgvector + FTS + migrations)
        packages/shared  ── domain model (zod) + API contracts
```

`@cortex/core` is **deterministic** and works with no keys. The intelligence, `@cortex/agents`
on top of an LLM, is **injected** from the entrypoints. Why each piece is the way it is lives
in [`docs/decisions.md`](./docs/decisions.md). How it actually works is explained in
[How Cortex works](./docs/how-it-works.md).

## The 8 MCP tools

The server serves the tools over **authenticated Streamable HTTP** on port 8788, with the
same Bearer token as the API, and applies the calling user's permissions.

Agents, on the other hand, launch their MCP servers as local stdio processes. The CLI is the
bridge:

```bash
cortex setup claude-code                # the usual way
claude mcp add cortex -- cortex mcp     # or by hand
```

`cortex mcp` never touches the database. It forwards to the server using the token from
`cortex auth login`, and discovers the URL from `GET /client-config`, which `CORTEX_MCP_URL`
can override. If there is no session, or the token expired, **your agent still starts**, with
no tools and a warning in its log, and calls come back telling you to sign in again. A tool
server that fails to initialise takes the whole session with it, which is worse than having
no memory.

There is also a stdio MCP inside the repository (`pnpm mcp`), but it talks to Postgres
directly and applies no permissions. It is for developing the server, not for daily use.

| Tool | What it does |
| --- | --- |
| `save_project_context` | Save knowledge: classifies, summarises, flags duplicates and contradictions |
| `search_project_context` | Hybrid search, vector plus lexical, with optional rerank |
| `get_project_context_pack` | A briefing for a project or area; `asOf` gives a point-in-time view |
| `list_project_decisions` | The decisions currently in force |
| `validate_context_entry` | Validate, reject, or mark obsolete |
| `ask_project_context` | A question in plain language, answered from the memory with sources |
| `search_project_code` | Hybrid search over the project's indexed code |
| `lint_project_context` | Health of the memory: contradictions, duplicates, gaps |

## How Cortex reaches your agents

Cortex ships **its own** pieces, the MCP with the 8 tools, the `cortex-capture` skill and the
`/cortex-save` command, in the [Claude Code plugin](./plugin/claude-code), which
`cortex setup` installs. Codex reads the same marketplace and takes the same plugin. The
other agents are configured through their own native mechanism by the same command. The
plugin also carries the two hooks that close the loop.

Separately there is **your organisation's toolbelt**, the MCPs and skills for whatever tools
your team uses. That installs from an **external registry**, usually in a private repository.
It deliberately does not live here: it is not product, it is one company's configuration
(ADR-0014 revised, ADR-0026 and ADR-0032).

```bash
cortex toolbelt doctor                                # what each entry needs to authenticate
cortex toolbelt sync --registry <path|url> --apply    # install it into your agents
```

The file format is documented in [`docs/toolbelt-registry.md`](./docs/toolbelt-registry.md).

Either way, what gets distributed is **configuration, never credentials**. Every entry
declares what authentication it needs, and entries whose variables are not exported are
skipped with a warning. A half-registered MCP is worse than an absent one, because the agent
retries it on every start.

## Ingesting sources (connectors)

Connectors run from the CLI and write **through the authenticated API**, so they get
attribution, permissions and batched embedding. They need `cortex auth login` and a running
server. The first argument is the project **slug** from `cortex link`:

```bash
cortex connect-docs     "<slug>" <dir>          # a folder: Markdown and plain text
cortex connect-github   "<slug>" <owner/repo>   # pull requests and issues, via gh
cortex connect-sessions "<slug>" <repo-path> [claude|codex|opencode|hermes|pi]

cortex-admin connect-docs    "<slug>" <dir>     # the same, plus documents, images, audio, video
cortex-admin connect-notion  "<slug>" <export>  # a Notion export, pages and attachments linked
```

`connect-docs` exists in both. The CLI one reads what needs no dependencies — Markdown and plain
text, which is most documentation and all of a Notion export — and **reports what it left out**,
grouped by extension. Documents, spreadsheets, images and audio need extraction libraries and a
model, which stay on the server side rather than on every laptop
([ADR-0058](./docs/decisions.md#adr-0058)); for those, an operator runs the `cortex-admin`
version.

By default capture types each item **heuristically**, which is cheap, and the intelligence,
re-typing with an LLM, the graph, reconciliation and curation, is applied afterwards by
`cortex-admin maintain`. With `CORTEX_CAPTURE_LLM=1` each item is classified by the LLM at
ingestion time instead, which gives you reliable types from minute one at the cost of one LLM
call per item.

Code indexing and the standalone maintenance passes are operator commands, so they live in
`cortex-admin`. See `cortex-admin --help`.

## Running the server

You need Node 20 or newer, pnpm and Docker.

```bash
git clone git@github.com:Dinacode-Labs/cortex.git && cd cortex
pnpm install
cp .env.example .env          # providers, email for the sign-in code, admin, allowed domain
pnpm build                    # compile to dist/; in dev the `dev` scripts run from source
pnpm db:up && pnpm db:migrate # Postgres + pgvector on host port 5433, plus the schema
pnpm admin server             # HTTP API and auth on 8787; also serves /install.sh
pnpm web                      # web UI on 8080
pnpm admin mcp-http           # authenticated MCP over HTTP on 8788
pnpm admin maintain-worker    # scheduled maintenance
```

- **Two binaries, deliberately.** `cortex` is the **developer** CLI: auth, link, setup,
  toolbelt, doctor and the hooks. It is light and installable, with no database and no model.
  `cortex-admin` holds the **operator** commands, migrations, maintenance, ingestion, the
  heavy connectors and the services, and lives in the deployment image. While they were one
  binary, installing Cortex meant dragging Postgres and Mastra onto the laptop of anyone who
  just wanted to link a repository.
- **API endpoints** on 8787. Public: `/health`, `/client-config`, which is what a client needs
  to know before authenticating including the MCP URL, `/version`, `/toolbelt.json`,
  `/install.sh` and `/auth/request|verify`. Bearer-authenticated: `/auth/me`, `/auth/logout`,
  `/auth/ui-ticket`, `/context-pack`, `/capture`, `/capture/batch`, `/capture/session` and
  `/capture/session/:id`, `/relate`, `/projects`, `/projects/:slug` (`GET`/`PATCH`) and
  `/projects/:slug/members`.
- **Auth.** Sign-in by email and one-time code, no passwords. A user **is** their email
  address. `CORTEX_AUTH_DOMAIN` is the allowed-domains list and **has no default**: empty
  means anyone in the world can sign up, so set it in production. The server warns on start if
  you have not. Admins come from `CORTEX_ADMIN_EMAIL`, comma-separated, and see every project.
  Delivery of the code is pluggable through `CORTEX_EMAIL_PROVIDER`: `log` prints it and sends
  nothing, which is the default, or `brevo` or `smtp`. The configuration is validated at boot.
- **Branding.** Everything a user sees, the web UI, the emails, the injected context and the
  CLI, takes its name from `CORTEX_BRAND_NAME`, default `Cortex`, and optionally a logo from
  `CORTEX_BRAND_LOGO_FILE` or `CORTEX_BRAND_LOGO_SVG`. With no logo you get the Cortex mark
  ("Relay": two pieces that change places, a centre that stays), which is one 8×8 drawing shared
  by the web header, the favicon (`/favicon.svg`) and the CLI splash (what it means and how it
  is built: [`docs/brand/README.md`](docs/brand/README.md)); with your own logo, the
  web shows yours and the CLI shows no mark at all. The splash only appears on an interactive
  terminal (`cortex` with no arguments and `cortex version`), never in CI, with `TERM=dumb` or
  in the hook and MCP commands, and honours `NO_COLOR`.

  EMBEDDINGS_PROVIDER=openai-compatible  # local | openai-compatible | openai | voyage
  EMBEDDINGS_BASE_URL=https://api.example.com/v1
  EMBEDDINGS_API_KEY=...
  EMBEDDINGS_MODEL=...
  EMBEDDINGS_DIM=4096                    # required: it fixes the vector schema
  ```
  `local` is not semantic, it only exists so the thing starts without keys. Changing embedding
  provider means reindexing, because the dimensions change. `CORTEX_MODEL_<ROLE>` overrides the
  model for one agent and accepts `provider:model` to send a single role somewhere else, for
  example `CORTEX_MODEL_RETRIEVER=openrouter:x-ai/grok-4.5`. `CORTEX_LLM_CONCURRENCY`,
  default 4, caps parallel calls, because providers meter per API key rather than per endpoint.
- **Maintenance** runs on the server, is idempotent and takes a lock:
  `pnpm admin maintain ["<Project>"]` chains reclassify, enrich, resolve, temporal, curate,
  reconcile and lint. Syncing sources is **manual**, triggered by a developer. This is
  maintenance only.
- **Measuring quality.** Two evaluation sets ship with the repo, both run as operator commands.
  `pnpm admin eval` measures **retrieval**: recall@5 and MRR over a fixed corpus with annotated
  evidence. `pnpm admin eval-distill` measures the **distiller** over a set of session windows
  with an annotated expectation each -- what it keeps, what it drops and what it files under the
  wrong type -- in English, or in the corpus's own language with `--lang es`, each set with its
  own mark; `--verbose` prints every item it emitted. Both need a real provider, and
  `eval-distill` refuses to run without an LLM, because the distiller *is* the model and with no
  model every window comes back empty. What each set contains and what the numbers mean:
  [`tests/fixtures/eval/README.md`](./tests/fixtures/eval/README.md).

### Deployment

One host with Docker. Caddy in front with automatic TLS, and behind it the API, the UI, the
MCP, Postgres, the maintenance worker and daily backups (ADR-0027).

```bash
cp deploy/.env.example deploy/.env     # domain, passwords, email, providers
chmod 600 deploy/.env
docker compose -f deploy/docker-compose.yml up -d
```

Everything hangs off a single domain: `/` the web UI, `/api/*` the API, `/mcp` the MCP and
`/install.sh` the installer, served with the public URL already injected. Only Caddy publishes
ports; Postgres never faces the internet. The image is pulled from the registry, not built on
the server.

The procedures, first deployment, upgrading, backups, restoring with a dry run, and rotating
credentials, are in [`deploy/README.md`](./deploy/README.md).

## Repository layout

```
apps/        mcp-server (MCP stdio + HTTP) · web (UI) · server (API + auth)
             cli (@dinacodelabs/cortex, published to npm) · admin (operator, lives in the image)
packages/    shared · client (client side) · database · embeddings · core · agents
plugin/      claude-code/ (hooks + MCP + cortex-capture skill + /cortex-save)
deploy/      docker-compose.yml · local.yml · Caddyfile · restore.sh · README.md
config/      toolbelt.json (schema for third-party registries)
scripts/     install.sh · set-version.mjs · changelog-notes.mjs
docs/        how-it-works.md · decisions.md (ADRs) · design.md (web UI) · roadmap.md · research/
```

The **dependency rules** between packages, which one may import which, are in
[`CLAUDE.md`](./CLAUDE.md), and there are tests that enforce them. Before touching an area,
read the decisions in [`docs/decisions.md`](./docs/decisions.md). Almost everything that looks
odd is explained there.

> The ADRs, the roadmap and the research notes are written in Spanish. They are the team's
> working record rather than product documentation, and translating them would freeze what is
> meant to stay alive. Everything a user or an agent sees is in English.

How to contribute, where each thing lives, and the conventions: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## License and security

Cortex is published under the [Apache License 2.0](./LICENSE). See also [`NOTICE`](./NOTICE).

Found a vulnerability? Do not open a public issue. Follow [`SECURITY.md`](./SECURITY.md).
To contribute, see [`CONTRIBUTING.md`](./CONTRIBUTING.md); how we treat each other is in the
[code of conduct](./CODE_OF_CONDUCT.md).
