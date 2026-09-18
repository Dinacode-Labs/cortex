# Roadmap — Cortex

What is left to do. The settled decisions live in [`decisions.md`](./decisions.md), what changed
in each version in [`CHANGELOG.md`](../CHANGELOG.md), and what the UI is for in
[`design.md`](./design.md).

> Only the technical **what** goes here. Business priorities, owners and each deployment's
> configuration belong to each operator and are not documented here (ADR-0031).

## Status (16 September 2026, v0.1.10)

Working, and in daily use by a team:

- **Identity, permissions and hierarchy.** Sign-in by email and code. Every entry carries who
  wrote it. Public or private projects with an owner and members, and client → project with
  inheritance. Visibility, owner, parent and the deletion of empty projects are all managed at
  runtime.
- **The automatic loop in five agents** (Claude Code, Codex, OpenCode, Hermes, Pi): they receive
  the context when a session opens and capture when it closes, through `cortex setup`.
- **Distillation on the server**: no laptop needs model keys. Idempotent per session,
  incremental when the session grew, and when it does not fit whole it spreads the windows
  across the entire conversation instead of keeping only the beginning.
- **A lightweight client on npm** (`@dinacodelabs/cortex`), with `connect-docs`,
  `connect-github` and `connect-sessions`. MCP over authenticated HTTP with the 8 tools
  applying permissions.
- **A complete context pack**: the eleven types that describe the project's state, split by
  budget and weighted, with contradiction warnings glued to each entry.
- **A web UI around the project**: memory, ask, what the agents see, health, map, code and
  settings, with a design system of its own.
- **Production**: an image in a registry, Caddy with TLS, healthchecks, daily backups with a
  restore drill, and `/metrics` in Prometheus format.
- **Measured retrieval**: `pnpm admin eval`, 40 questions with annotated evidence. recall@5
  **0.987**, MRR **0.928**. Contextual Retrieval is still deferred **on a measurement rather
  than on a hunch**: the paraphrased questions retrieve at 1.000, which is exactly where the
  failure would show.

## What is left

### What is already hurting

- **Nobody validates.** 608 current entries, **608 unreviewed**. Status and confidence are the
  two fields that exist so an agent knows what to trust, and while they go unused they tell
  nothing apart: the pack cannot prioritise by reliability even though it knows how. Half of
  this loop belongs to people, not to code; what the code could do -- make it visible and
  filterable -- is already done.
- **`search` and `ask` do not inherit from the parent.** The context pack climbs the ancestor
  chain and search does not, so inside a child project you do not find what is stored in the
  client. With real hierarchies being set up right now, this already shows.
- **Health shows and does not fix.** Contradictions, duplicates and gaps link to their entries,
  but merging or resolving is still hand editing, when `core` has the functions
  (`planLintActions`, `saveWithReconciliation`).
- **A project cannot be renamed.** The name and the slug are fixed at creation; getting it wrong
  forces deleting and redoing, and only when it is empty.

### Ingestion

- **Extraction on the server.** Today the CLI reads Markdown and plain text, and the formats
  that need mammoth/unpdf/xlsx or a model stay in `cortex-admin` (ADR-0058). The server already
  has the dependencies and the keys: uploading the file and extracting there would let the CLI's
  connector cover everything and make this split disappear.

### Operation and scale

- **An inference limit shared across processes.** The semaphore is **per process** and a
  deployment runs four that call the model, so the real ceiling is
  `processes × CORTEX_LLM_CONCURRENCY` and today that division is done by hand. A real limit
  needs shared state: `shared` cannot depend on the database, so it would be injected from the
  entrypoints, like the classifier. Before building it, it is worth measuring whether the
  backoff that already exists absorbs the overflow; there is no 429 data today because usage is
  a handful of people.
- **A persistent capture queue.** It lives in memory: a restart with queued jobs loses them. At
  the current volume it is not worth it; with several teams capturing at once, it will be.
- **In-memory MCP sessions**, which ties the deployment to a single node.
- **Per-request metrics** (latency, response codes). `/metrics` exposes the system's state, not
  the traffic's. The natural place is a middleware feeding the same endpoint.
- **A general per-IP request limit.** Sending codes is already covered per IP as well as per
  email, which is the one unauthenticated place with an effect -- and a cost -- outside the
  server. For everything else the natural place is still the edge: Caddy or the CDN.
- **An ANN index** in pgvector. Today it is 609 vectors and the sequential scan is more than
  enough; the threshold is in the tens of thousands.

### Interface

- **Entity pages.** Entities show up as labels that launch a search; the graph knows more than
  the UI shows.
- **Pagination.** No list has it: fixed limits and no sign that there is more.
- **Edit history.** Correcting an entry overwrites and leaves only `updated_at`. For a system
  whose argument is provenance, that is a gap, and it will be closed when somebody asks.
- **Dark mode.** It is now a matter of redefining tokens under a media query, not a rewrite.

### Product

- **A per-project toolbelt registry**, alongside the organisation's.
- **Per-project AI config** (which models and which sources each one uses), in the external
  registry.
- **A navigable index inside a project (to be studied).** A per-area map the agent walks,
  instead of depending on search alone. The counter-argument is still unresolved: an
  always-present index competes for the context budget and goes stale on every change, and
  search avoids both. It would have to be shown to win in some specific regime -- enormous
  projects, "knowing what exists" versus "finding what is relevant". If it came out in favour,
  it would be generated in `maintain` and with provenance: it would be inference, not fact.

## The road to opening the code

The repository **is already public** and the ADRs are in English. What remains:

1. **A compiled binary and Homebrew.** Today the CLI requires Node >= 20; a binary removes that
   requirement, at the cost of signing, notarisation and four build targets. It was deliberately
   postponed until the product was in somebody's hands (ADR-0025), and it now is.
2. **v0.2.0**: retire the `LLM_PROVIDER=nan` alias and the `BREVO_SENDER` variable. The code
   accepts them with a warning and the templates no longer offer them.
