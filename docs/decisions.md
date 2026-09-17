# Decision records

Every entry here is a **working hypothesis**, not a settled truth. It records what was chosen,
why, what was considered instead, and — the part that matters most — **when to revisit it**.
A decision whose premise stops holding is not an embarrassment; leaving it unmarked is.

Each record follows the same shape: **status · context · decision · alternatives · revisit
when**. Numbers are stable identifiers, not an order of importance: they are cited from the
code and from other records, so they never change. The file is ordered by number; the story is
in the index below.

## How this got here

Reading the records by date, the project went through six phases. They are worth naming,
because each one turned on something learned rather than on a change of mind.

**Foundations — June 2026** ([0001](#adr-0001)–[0012](#adr-0012), [0015](#adr-0015),
[0016](#adr-0016)). One Postgres holding documents, vectors and the graph; TypeScript
everywhere; MCP as the interface to agents. The unglamorous choice — a relational graph rather
than a graph database — was made explicitly so it could be revisited, and it has not needed to
be.

**From prototype to something several people can use — 24 June 2026**
([0036](#adr-0036)–[0040](#adr-0040)). Projects with a slug and a server-side gate, a
parent/child hierarchy, a one-shot ticket so the token never travels in a URL, MCP over
authenticated HTTP, and a deployment. This is where "a demo" stopped being an accurate
description.

**Cleaning up the architecture — 3 July 2026** ([0041](#adr-0041)–[0046](#adr-0046)). A single
access policy instead of three, one canonical way to resolve a project by name, the multimodal
layer injected rather than imported, and the UI deliberately kept as server-rendered HTML with
a written threshold for when that would stop being the right answer.

**Writing down the limits — 6 July 2026** ([0017](#adr-0017)–[0022](#adr-0022),
[0047](#adr-0047)). The most useful batch, and the least flattering: Mastra's workflow engine
evaluated and **rejected**, Spanish-only full-text search, a hardcoded price table, row schemas
used as types only. Recording what does not work is what keeps a log honest.

**Turning it into a product — 10 September 2026** ([0013](#adr-0013), [0014](#adr-0014),
[0024](#adr-0024)–[0032](#adr-0032)). Brand out of the code, the client split so the CLI could
be installed from npm without a database, distillation moved to the server, per-agent
integration, a real production deployment, a licence, and an explicit line between publishing
the code and publishing how it is run.

**Using it for real — from 11 September 2026** ([0033](#adr-0033)–[0035](#adr-0035),
[0048](#adr-0048)–[0049](#adr-0049)). Several
Cortex servers at once, memory exposed as tools an agent already looks for, contradictions
surfaced instead of silently resolved, something to point an alert at, and a context pack that
shortens by sharing out the room rather than by cutting off the end. They came out of running
it daily and finding things that no amount of design would have predicted.

**The web UI gets a job — 15 September 2026** ([0050](#adr-0050)–[0052](#adr-0052)). A
full pass over the running interface: what it is for (audit and repair), how it is organised
(around the project), what a project's life looks like after creation (visibility, owner and
members can change; nothing is born without a slug), the rule that made the landing page empty
(scope in the query, never after a limit), and how it is styled — one stylesheet as a design
system, a component layer, and no framework ([0053](#adr-0053)).

> **Why records 0036–0047 carry late numbers for early decisions.** They were written on the
> dates above but never given a number, so nothing could cite them — two were already referred
> to by title alone. They were numbered on 2026-09-12, taking the next free identifiers. The
> date on each is the real one.

---

<a id="adr-0001"></a>

## ADR-0001 · A pnpm monorepo

- **Status:** accepted (2026-06-22).
- **Context:** several pieces — shared types, database, embeddings, agents, the MCP server,
  the web app — share the same domain model. Keeping them in step across repositories costs
  more than it gives at this size.
- **Decision:** one pnpm monorepo: `packages/*` for libraries, `apps/*` for things that run.
- **Alternatives:** separate repositories (`cortex-api`, `cortex-mcp`, …), which means
  versioning overhead on every shared type change.
- **Revisit when:** more than one team ships from this repository on independent schedules.

<a id="adr-0002"></a>

## ADR-0002 · TypeScript across the whole stack

- **Status:** accepted (2026-06-22).
- **Context:** Mastra is TypeScript-first and the official MCP SDK has good TypeScript
  support. Two of the three interfaces we depend on point the same way.
- **Decision:** TypeScript with ESM (`NodeNext`), Node ≥ 20, run with `tsx` in development.
- **Revisit when:** a component appears that clearly belongs on another runtime.

<a id="adr-0003"></a>

## ADR-0003 · One Postgres with pgvector, for documents and vectors alike

- **Status:** accepted (2026-06-22).
- **Context:** the tempting move is a dedicated vector database next to a relational one. That
  is two stores to operate, and two places a write can half-succeed.
- **Decision:** a single Postgres 16 (`pgvector/pgvector:pg16`) holding metadata, entities,
  relations, sources **and** embeddings in a `vector` column. Similarity search in SQL with
  `<=>`.
- **Alternatives:** Qdrant, Weaviate, Pinecone. They bring filtering and scale, and a second
  system to run.
- **Revisit when:** volume or search latency actually justifies it — see [0003](#adr-0003)'s
  companion note in the roadmap about an ANN index, which is the step before splitting stores.

<a id="adr-0004"></a>

## ADR-0004 · The knowledge graph is relational, for now

- **Status:** accepted (2026-06-22).
- **Context:** "knowledge graph" suggests a graph database. At this size, what we need from a
  graph is one or two hops from an entity.
- **Decision:** model it with `entities` + `relations` tables in Postgres, traversed with SQL.
- **Alternatives:** Neo4j, Memgraph, ArangoDB — worth it for deep traversals.
- **Revisit when:** multi-hop queries become frequent rather than hypothetical.

<a id="adr-0005"></a>

## ADR-0005 · Pluggable embeddings and LLM, with a local fallback that needs no keys

- **Status:** accepted (2026-06-22).
- **Context:** a development machine may have no API keys at all, and the project should start
  anyway. Connecting a real provider should be a line of configuration, not a refactor.
- **Decision:** a provider interface with a `local` implementation as the default —
  deterministic and **not semantic**, only good for exercising the wiring — plus real
  providers. Without an LLM key, the system falls back to heuristics wherever it can.
- **Known risk, recorded deliberately:** `local` embeddings give no real relevance. Search
  quality can only be judged with a real provider, which is why the retrieval evaluation
  ([roadmap](./roadmap.md)) refuses to report numbers from `local` without a warning.
- **Revisit when:** a provider is settled on for cost and multilingual quality.

<a id="adr-0006"></a>

## ADR-0006 · Mastra as the agent runtime — partially validated

- **Status:** partially validated (2026-06-22). In use for text generation; structured output
  goes through a direct client instead — see [0008](#adr-0008). Its *workflow* engine was
  evaluated and rejected in [0017](#adr-0017).
- **Context:** an agent runtime was wanted for the LLM layer. What needed validating:
  structured output, MCP, workflows, observability.
- **Decision:** `@cortex/agents` uses Mastra's `Agent` for the retrieval agent — prose
  synthesis — which works well.
- **What was found:** Mastra's `structuredOutput` **hung** with the model in use, most likely
  attempting a `json_schema` mode the model does not support. Plain text generation was fine.
  That finding is the reason [0008](#adr-0008) exists.
- **Alternatives:** LangGraph, LlamaIndex Workflows, CrewAI, or no framework at all.
- **Revisit when:** the model or provider changes, or a Mastra version fixes structured
  output.

<a id="adr-0007"></a>

## ADR-0007 · MCP as the standard interface to AI tools

- **Status:** accepted (2026-06-22).
- **Context:** Claude Code first, other agents later, without coupling the product to any of
  them.
- **Decision:** an MCP server (official TypeScript SDK) exposing neutral tools:
  `save_project_context`, `search_project_context`, `get_project_context_pack`,
  `list_project_decisions`, `validate_context_entry`, `ask_project_context`.
- **Revisit when:** per-developer authentication and permissions are defined — which happened
  in [0039](#adr-0039).

<a id="adr-0008"></a>

## ADR-0008 · A direct client for structured output, an agent for prose

- **Status:** accepted (2026-06-22). The provider choice here was superseded by
  [0024](#adr-0024); the split between structured and prose calls still stands.
- **Context:** classification and extraction need reliable JSON. [0006](#adr-0006) found that
  the agent runtime could not deliver it with the model in use.
- **Decision:** two paths on purpose. **Structured** calls go straight to `chat/completions`
  with `response_format: json_object`, zod validation and one retry — with a generous
  `max_tokens`, because a reasoning model needs room to think before the JSON. **Prose
  synthesis** uses the Mastra agent.
- **Coupling:** `@cortex/core` does not depend on `@cortex/agents`. Entrypoints register the
  classifier with `setClassifier(...)` when an LLM is available; without one, everything falls
  back to heuristics. Precedence is explicit input > LLM > heuristic.
- **Version note:** `@cortex/agents` uses zod v4 and AI SDK v6 because Mastra requires them,
  isolated from the zod v3 the rest of the repository uses. Schemas never cross.
- **Revisit when:** a provider and model are settled — see [0024](#adr-0024).

<a id="adr-0009"></a>

## ADR-0009 · Hybrid search (vector + full text + RRF) with an optional LLM rerank

- **Status:** accepted (2026-06-22).
- **Context:** search was purely dense vectors. Lexical matching wins on identifiers, proper
  nouns and jargon, which is most of what people actually search for. Hybrid plus rerank is
  the industry standard.
- **Decision:** `searchContext` runs `hybridSearch`: vector candidates from pgvector plus
  lexical ones from Postgres full-text search (a generated `content_tsv` column, GIN index),
  fused with **Reciprocal Rank Fusion**. A second-stage rerank is **optional** and injected
  with `setReranker`; `CORTEX_RERANK=off` disables it.
- **What was found:** a dedicated reranker endpoint gave **unreliable results** — it ranked an
  omelette recipe above payment documentation. It is not used; an LLM rerank took its place.
- **Revisit when:** a reliable dedicated reranker is available, or a real BM25 implementation
  is worth the extra component.

<a id="adr-0010"></a>

## ADR-0010 · Linting the knowledge itself

- **Status:** accepted (2026-06-22). Extended by [0035](#adr-0035), which surfaces
  contradictions where they are read rather than only in the report.
- **Context:** a memory that only grows becomes a liability. Most systems in this space index
  and retrieve; almost none check the health of what they hold.
- **Decision:** `lintProject(project)` reports, per project: contradictions from the graph,
  likely duplicates by vector similarity, orphan entities, low confidence, superseded or
  obsolete entries, and **gaps** — areas with recorded incidents but no recorded decision.
  Available from the CLI and the web UI.
- **Revisit when:** the lint should **act** rather than report: propose merges, open work for
  the gaps, mark things obsolete.

<a id="adr-0011"></a>

## ADR-0011 · Indexing each project's code

- **Status:** accepted (2026-06-22).
- **Context:** the largest gap against comparable tools. They all index the repository; we had
  project context but not the code it describes.
- **Decision:** a `code_chunks` table, separate from `context_entries`, chunked by line
  windows (60 lines, 10 of overlap), with embeddings and full-text search, scoped by project.
  A walker that respects the usual ignores and caps file and total size. Hybrid search through
  `searchProjectCode`. Reindexing is idempotent per project and repository.
- **Limitations, recorded rather than hidden:** chunking is by lines, not syntax, so generated
  files skew the ranking. A syntactic chunker, a symbol graph and incremental sync are the
  obvious next steps and none of them is done.
- **Revisit when:** symbol-level search or incremental sync is worth the work.

<a id="adr-0012"></a>

## ADR-0012 · A bi-temporal graph: invalidating is not deleting

- **Status:** accepted (2026-06-22).
- **Context:** decisions change, and serving a stale one confidently is worse than serving
  nothing. The model had no notion of when a fact was true.
- **Decision:** `valid_from`, `valid_to` and `observed_at` on `context_entries` and
  `relations`; `valid_to IS NULL` means current. **Invalidating closes the window, it never
  deletes.** Retrieval and the context pack return only current facts by default and support
  point-in-time queries with `asOf`.
- **Result on a real project:** 266 current entries against 147 historical, with point-in-time
  queries returning the smaller set the system actually knew at an earlier date.
- **Limitation:** contradictions between entities are not auto-invalidated, because there is no
  reliable winner. [0035](#adr-0035) is what came of taking that limitation seriously.
- **Revisit when:** decay by volatility, or recency-based resolution of contradictions, is
  worth attempting.

---

<a id="adr-0013"></a>

## ADR-0013 · Neutral design tokens and a configurable brand

- **Status:** revised (2026-09-09). Previously: "the UI uses our own design system".
- **Context:** the UI was built with one company's design tokens and its wordmark embedded in
  `layout.ts`, with that company's name in the page title, the login screen, the one-time-code
  email and the context injected into agents. Once product and company were separated
  ([0026](#adr-0026)), that could not stay wired in: whoever deploys Cortex should not inherit
  the branding of whoever wrote it.
- **Decision:** the **tokens** stay as the default palette — two colours and two free
  typefaces, nothing proprietary, and redoing the design would buy nothing. The **brand is
  configuration**: `CORTEX_BRAND_NAME` (default "Cortex") in the title, header, login, email,
  injected context and CLI help; an optional logo through `CORTEX_BRAND_LOGO_SVG` or
  `CORTEX_BRAND_LOGO_FILE`, falling back to a text wordmark. `CORTEX_AUTH_DOMAIN` and the
  email sender lost their inherited defaults at the same time.
- **Security note:** the logo is inserted with `raw()`, so it is checked for looking like an
  SVG and not carrying `<script>`. This is operator configuration — anyone who can set the
  variable already controls the process — so the check is a guard against a careless mistake,
  not a sanitiser.
- **Alternatives:** a themed `@cortex/ui` package (over-engineering for one server-rendered
  UI); colour tokens by environment variable (noise without demand).
- **Revisit when:** a second operator asks for their own colours, or the UI changes stack.

<a id="adr-0014"></a>

## ADR-0014 · The product ships its own harness; an organisation's toolbelt is an external registry

- **Status:** revised (2026-09-10). Previously: "`config/` is the single source of the
  organisation's toolbelt".
- **Context:** `config/` mixed two different things. The **product's** harness — the Cortex
  MCP server, the capture skill, the save command — and one company's **internal tools**:
  issue tracker, chat, wiki and their vendored scripts. The second cannot live in a repository
  that is going to be opened, and does not need to: it is not product, it is one company's
  configuration.
- **Decision:** this repository ships **only its own** harness. An organisation declares its
  toolbelt in **its own registry** with the same schema and installs it with
  `cortex toolbelt sync <registry.json|url>`. The schema is documented in
  [`toolbelt-registry.md`](./toolbelt-registry.md) as part of the product.
- **What does not change:** the sync remains data-driven from the manifest, idempotent, dry-run
  by default, preserves existing configuration rather than overwriting it, and skips entries
  whose environment variables are missing. It distributes **configuration, never credentials**.
- **Alternatives:** keep the corporate toolbelt here and filter it out at publication time —
  fragile, one slip leaks internal names; or drop the feature entirely, losing something that
  works and is useful to any team.
- **Revisit when:** the Claude Code plugin absorbs skill and command distribution, at which
  point `config/` could disappear, or a per-project registry is wanted.

<a id="adr-0015"></a>

## ADR-0015 · The agent layer as real Mastra agents

- **Status:** accepted (2026-06-22).
- **Context:** the design called for several agents, but the implementation was making direct
  LLM calls because Mastra's structured output hung ([0006](#adr-0006)). Mastra was barely
  being used.
- **Decision:** rebuild the `agents` layer as **real Mastra agents**, one per role:
  `classifier`, `graph`, `reranker`, `retriever`. The model is reached through
  `@ai-sdk/openai-compatible`, so the provider is not baked in. Roles that return JSON use a
  `fetch` that **forces `response_format: json_object`**, because the model does not follow
  Mastra's structured output reliably — it invents keys — while `json_object` is fast and
  valid. The retriever uses free text.
- **Consequences:** per-agent instructions, observability and evaluations become available,
  with the same reliability and speed as before.
- **Revisit when:** a model follows structured output reliably, so the `fetch` can go and zod
  schemas can be used directly; or per-agent memory and tools are wanted.

<a id="adr-0016"></a>

## ADR-0016 · Measuring what the AI costs

- **Status:** accepted (2026-06-22). Two layers.
- **Context:** nothing measured tokens or cost. With a subscription provider the cost is zero,
  but "zero today" is not a reason to fly blind: switching to a metered provider should not be
  a leap in the dark.
- **Decision (A — our own tracking):** an `llm_usage` table with `recordUsage()` and
  `getUsageSummary()`. Every agent records tokens; embeddings report theirs through a **sink**,
  so the embeddings package stays a leaf and does not depend on core. A price table turns
  tokens into an estimate. A `/usage` page shows totals by operation, agent and model.
- **Decision (B — tracing):** agents are served from a Mastra instance with observability and
  **our own exporter**, persisting each span into an `ai_traces` table in the same Postgres.
  Mastra's own storage adapters were dropped after friction; a direct exporter writes
  immediately, which is what a CLI needs. CLIs flush before exiting.
- **Revisit when:** cost per project, budgets and alerts, or a bridge to an external tracing
  backend is wanted.

<a id="adr-0017"></a>

## ADR-0017 · Mastra's workflow engine: evaluated and not adopted for capture

- **Status:** accepted (2026-07-06). Supersedes the "workflows" part of [0006](#adr-0006) and
  the corresponding note in [0015](#adr-0015).
- **Context:** a spike orchestrated capture as observable workflow steps (classify → persist).
  It was about 140 lines of demonstration, and the **real** capture pipeline never used it —
  only the demo command did.
- **Decision:** **do not adopt** Mastra's workflows for capture, and delete the spike. Capture
  uses the **deterministic path in `core`** (`saveWithReconciliation`, with the reconciler
  injected), which is simpler and does not couple capture to a workflow runtime.
- **What stays:** Mastra **is** used for the individual agents. What was rejected is the
  workflow engine, not the agents.
- **Why:** the classify → persist step already lives in core. The workflow duplicated it
  through another API for no operational gain. Less code, less coupling.
- **Revisit when:** an orchestration need appears that core cannot express — long-running,
  resumable, human-in-the-loop.

<a id="adr-0018"></a>

## ADR-0018 · Identity stays in `@cortex/core`; no separate auth package

- **Status:** accepted (2026-07-06).
- **Context:** during the architecture refactor, extracting identity — one-time codes, tokens,
  tickets, admin checks, email — into its own package was evaluated.
- **Decision:** it **stays in core**. Not extracted.
- **Why:** the benefit is purely topological, that core would not "contain" identity. The
  applications already consume it through core's barrel without friction, and no bug or
  behaviour change is at stake. The cost is real: a new package, another tsconfig, two more
  test configurations, a bigger dependency graph, and breaking core's own use of the admin
  check. For a small team, that churn does not buy purity worth having.
- **Revisit when:** identity grows weight of its own — token rotation, SSO, multi-tenancy — or
  dependency rules get enforced by lint and this one gets in the way. The extraction stays
  mechanical: two files plus two pure helpers.

<a id="adr-0019"></a>

## ADR-0019 · Three ways to write context, documented rather than unified

- **Status:** accepted (2026-07-06).
- **Context:** three write functions had grown in core, and the instinct was to collapse them
  into one.
- **Decision:** they coexist, each for a different intent, and the **matrix is documented**
  instead of forcing a premature unification.
  - `saveContext` — a **direct** write: classify, summarise, extract entities, embed, run the
    improvement loops. Used by the web UI, and the base of the other two.
  - `saveWithReconciliation` — a **reconciled** write, deciding add, update, supersede or
    no-op against what is already there. Used by the capture API. Never rewrites curated
    knowledge.
  - `captureBatch` — **batch** ingestion from connectors: persist without embedding, index in
    one pass at the end, incremental by source reference, no classifier.
- **Why not unify yet:** the three cover genuinely different intents — low friction, anti
  duplication, batch throughput. Collapsing them is an API redesign with real risk; for now,
  writing down which to use buys most of the value.
- **Revisit when:** a fourth write case appears, or the three drift enough to cause a bug.
  They share `saveContext` as a base, so drift is currently low.

<a id="adr-0020"></a>

## ADR-0020 · Spanish-only full-text search — a known limitation

- **Status:** accepted (2026-07-06).
- **Decision:** the lexical branch of hybrid search uses Postgres's `'spanish'` configuration,
  even though the content is genuinely **mixed**: code, technical jargon and English pull
  requests alongside Spanish prose. Recorded as a conscious limit rather than fixed.
- **Why:** most of the business knowledge is Spanish, and English stemming over technical terms
  buys little. Real multilingual full-text search — per-entry language detection, a `tsvector`
  column per language, or `simple` plus n-grams — is work this scale does not justify. The
  vector branch covers some of the cross-language gap.
- **Revisit when:** poor recall is **measured** on English queries or content, or the corpus
  turns majority English. The retrieval evaluation exists precisely so this can be a
  measurement and not an opinion.

<a id="adr-0021"></a>

## ADR-0021 · A hardcoded price table, and the silent zero it implies

- **Status:** accepted (2026-07-06). Partly addressed by [0024](#adr-0024), which made the
  table overridable.
- **Decision:** cost estimation uses a fixed `PRICING` table in code. A model **not listed**
  falls back to zero, and reports a cost of **zero without warning**. Recorded; not moved to
  configuration.
- **Why:** with the default provider the real cost is zero, so the estimate only matters when
  a metered provider is connected. Token observability — the thing actually measured — is
  correct; cost is indicative. Prices as code are fine while the list is short.
- **Consequence accepted:** a `$0` that means "no price on file" looks exactly like a `$0` that
  means "free". That is the trap, and it is written down here so nobody rediscovers it during
  a billing surprise.
- **Revisit when:** a metered provider is used seriously. Then move prices to configuration,
  date them, and **log a warning** when a model has no price rather than reporting a misleading
  zero.

<a id="adr-0022"></a>

## ADR-0022 · Row schemas as types only, with manual mapping

- **Status:** accepted (2026-07-06).
- **Decision:** the zod schemas describing database rows are used **only as TypeScript types**.
  The `snake_case → camelCase` mapping is done by hand, with no `.parse()` at the boundary.
- **Why:** rows come from our own database, whose shape is controlled by migrations, not from
  outside. Validating every row on the hot read path costs something and protects against
  nothing real. The boundaries that *are* untrusted — the HTTP API and forms — do validate with
  zod. Schemas as types give the static check without the runtime cost.
- **Consequence accepted:** a row schema can drift from the real table, because nothing parses
  it. Harmless while it is only read as a type; worth syncing if it is ever used to build rows.
- **Revisit when:** a row schema is used to **validate** data going into the database, or the
  drift causes a bug.

---

<a id="adr-0023"></a>

## ADR-0023 · Model strategy by role, and chunking

- **Status:** **partly superseded by [0024](#adr-0024)** (2026-09). It planned a forced
  migration away from the inference provider we were using, on the assumption that access
  would be lost. That did not happen, so the provider parts are superseded. What **still
  stands** is the routing by role, the chunking work, and the discipline of measuring.
- **Context:** four problems at once. The agents all shared **one model**, ignoring that the
  roles differ enormously in how much a mistake costs — a bad reconciliation destroys
  knowledge, a bad rerank is merely annoying. Access to the inference provider was expected to
  end. Document chunking was broken: a document entered as one entry and one vector
  **truncated at 8,000 characters**, so ingesting long documentation did nothing useful. And
  the goal throughout was to learn to do this ourselves on our own pgvector rather than rent a
  managed RAG.
- **Decision:**
  1. Move off the current provider to metered ones.
  2. **Route by role** through `CORTEX_MODEL_<ROLE>`, with a separate vision model: cheap
     models for the mechanical roles, stronger ones where judgement is destroyed if wrong, and
     the best one for the retriever, which is the only role a person reads directly.
  3. A multilingual embedding model, since the corpus is Spanish.
  4. **Chunking:** structural, respecting headings and pages, and fix the 8k truncation.
  5. **Measure, do not argue:** a retrieval evaluation set with recall@5 and MRR before and
     after every change.
- **Rejected alternatives:** local embedding models — the good ones need a native runtime in
  Node, and the small ones are English-centric, which drags deduplication down with them; a
  managed RAG service — floor costs, lock-in, and precisely the thing we wanted to learn.
- **Consequences accepted at the time:** a hard dependency on paid keys even for development,
  and a one-off recalibration of the deduplication thresholds, since those were tuned for a
  specific embedding dimension.
- **What actually happened:** point 5 took a year less seriously than it deserved and was only
  built in September. When it was, it showed no loss of context from chunking — which is the
  measurement that kept Contextual Retrieval deferred rather than built on a hunch.

---

<a id="adr-0024"></a>

## ADR-0024 · A generic `openai-compatible` provider, and routing by role

- **Status:** accepted (2026-09-10). Supersedes the **provider** part of [0023](#adr-0023);
  keeps its routing by role, chunking and evaluation discipline.
- **Context:** [0023](#adr-0023) planned a forced migration because we expected to lose access
  to a provider. It never happened — and revisiting it surfaced the real problem, which was
  not the provider at all: the vendor was **wired in as a `case`** inside `llm-config.ts` and
  `embeddings/index.ts`. A specific vendor embedded in two packages that ought to be generic,
  which also made it impossible to point at a local endpoint (Ollama, vLLM, LM Studio) — the
  very on-premise requirement [0023](#adr-0023) had listed as a contingency.
- **Decision:**
  1. **A generic `openai-compatible` provider** for chat and embeddings, with
     `EMBEDDINGS_DIM` required because the dimension defines the vector schema. Every endpoint
     worth supporting speaks the same dialect, so the vendor becomes **configuration, not
     code**. The old vendor name survives as a compatibility alias for one version, with a
     warning. A local endpoint without authentication requires an explicit
     `LLM_ALLOW_NO_KEY`, so a forgotten key is never mistaken for "it is local".
  2. **Routing by role.** `CORTEX_MODEL_<ROLE>` accepts `provider:model`, so one role can go
     to a different provider with its own credentials without moving the rest. The case that
     motivates it is the **retriever**: the only role whose output a person reads, and
     therefore the only one where paying for more quality is obviously worth it.
  3. **A concurrency semaphore** shared by chat, vision, speech and embeddings, because
     providers limit requests **per key**, not per kind of endpoint. Without it, maintenance
     runs at concurrency 8 trip rate limits in bursts and the backoff costs more than the
     parallelism saved.
  4. **Prices** stay in code ([0021](#adr-0021)) plus an optional `CORTEX_PRICING_JSON` to
     correct or add one without a deployment. That closes [0021](#adr-0021)'s "revisit when".
- **Rejected alternatives:** *carry out [0023](#adr-0023) as written* — it forced paid keys
  even for development with no measured gain in quality; *keep the vendor as a case in the
  code* — blocks on-premise use and leaves a specific vendor inside packages that should be
  generic.
- **Consequences:** no data migration as long as the embedding model and dimension stay the
  same; changing either means re-embedding the corpus and recalibrating the deduplication
  thresholds. The `local` provider is for tests and for starting without keys, nothing else.
  **Which provider a given deployment uses, with which models and which key, is the operator's
  decision and is not documented here** — see [0031](#adr-0031).
- **Revisit when:** a reason appears to couple the code to a provider again (it should not), or
  the compatibility alias is removed.

<a id="adr-0025"></a>

## ADR-0025 · `@cortex/client`: splitting the client side so the CLI can ship on npm

- **Status:** accepted (2026-09-10). Supersedes "credentials and the API client live in
  shared" ([0044](#adr-0044)).
- **Context:** installing Cortex meant cloning the whole repository over SSH and dragging
  every server dependency onto a laptop — the document extractors, the agent runtime, the
  Postgres driver — around 235 MB for a CLI that mostly makes HTTP calls. Worse, the LLM
  distillation of each session ran **on the laptop**, with an API key in a cloned `.env`. And
  the stdio MCP server talked straight to Postgres, which a laptop does not have.
- **Decision:**
  1. **`packages/client`** concentrates the client side: credentials, the HTTP client,
     `.cortex.json`, transcript reading, session readers. It depends only on `shared` — no
     Postgres, no LLM. A test enforces it, because it is an easy rule to break by accident.
  2. **`apps/cli` is published to npm** as a single bundled file, with operator commands moved
     to a separate `apps/admin` that lives in the Docker image instead.
  3. **Distillation moves to the server.** The hook condenses and scrubs locally — no model
     needed — and posts the result. The server distils with its own key. No laptop needs an
     API key, and the rate limit is managed in one place.
  4. **`cortex mcp` is a stdio-to-HTTP proxy** authenticated with the user's token, so an
     agent gets the tools with that user's permissions and no database.
- **Alternatives:** a compiled binary with a package manager — better experience, but signing,
  notarisation and four targets; a private registry — a token per developer; a tarball served
  by the server itself — not standard, and no marketplace can consume it.
- **Consequences:** the server spends the inference budget for everyone's sessions, so capture
  runs through a bounded queue. The condensed, scrubbed transcript travels to the server.
- **Revisit when:** a compiled binary becomes worth it, or session volume demands a persistent
  queue.

<a id="adr-0026"></a>

## ADR-0026 · Product and company separated; the corporate material moved out

- **Status:** revised (2026-09-12). Points 1, 2 and 4 stand as written. Point 3 said the
  history would not be rewritten *while the repository was private* — the repository became
  public, so that premise no longer held, and the history **was** rewritten on 2026-09-12.
  See below.
- **Context:** the repository contained things that are not product: an internal founding plan
  with business strategy, an internal workshop and its assets, brand artwork, the skills for
  one company's internal tools, and — scattered through the documentation — real clients named
  and colleagues listed as owners of work.
- **Decision:**
  1. Everything corporate moves to a **separate private repository**: the full registry, the
     internal skills, the founding documents, the branding and the deployment values.
  2. References to clients and people are **neutralised** in place: "a real project", "Acme".
     The technical substance stays — the bi-temporal figures are still the real measurements —
     and only the identity is lost. Two already-applied migrations that name a client in a
     comment **are left alone**: editing an applied migration is a worse practice than the
     comment it would fix.
  3. **The history.** Originally: do not rewrite it, because the repository was private and
     rewriting would invalidate every clone and break the pull request links cited in these
     records; open the code later from a clean snapshot instead. The repository was opened with
     its history, so on 2026-09-12 the history **was** rewritten to drop the internal material,
     after checking that it contained no credentials and no client names, and with no forks in
     existence. Rewriting a public history remains something to do once, deliberately, with a
     backup: it breaks links to old diffs, and unreachable objects survive on the host until
     the provider is asked to purge them.
  4. `.gitignore` blocks the internal paths so the material cannot drift back in.
- **Alternatives:** filter at publication time instead of separating now — fragile, one slip
  leaks; a `private/` folder inside the monorepo — it leaks anyway, and does not help when the
  installer clones the whole repository onto every laptop.
- **Revisit when:** another category of sensitive material is found, or the rule in
  [0031](#adr-0031) needs sharpening.

<a id="adr-0027"></a>

## ADR-0027 · Production: a compiled image in a registry, TLS, backups and health checks

- **Status:** accepted (2026-09-10). Supersedes "deployment with docker-compose"
  ([0040](#adr-0040)).
- **Context:** the previous image copied the whole repository and ran TypeScript sources with
  development dependencies as root, with no TLS, no health checks on the applications and no
  backups — and it was built on the server itself.
- **Decision:**
  1. A **multi-stage `Dockerfile`** — dependencies, then a compiled build, then a slim runtime
     as a non-root user with a health check. One image serves every process.
  2. Published to a **container registry** by the release workflow; the server only pulls.
  3. **One host, one certificate.** A reverse proxy is the only service with open ports and
     routes by path: the web UI, the API under a prefix, the MCP endpoint without buffering so
     streaming works, and the installer script. Postgres stays on the internal network.
  4. `NODE_ENV=production` turns on secure cookies; security headers everywhere; the bind
     address is configurable so nothing listens on every interface by accident.
  5. **Real health checks** — a `SELECT 1`, not a static 200 — plus a heartbeat for the worker,
     which has no port to probe.
  6. **Daily backups** with retention, and a restore script with a **dry-run mode**, because a
     backup that has never been restored is not a backup.
- **Alternatives:** three subdomains (triples the DNS and the URLs); a platform-as-a-service
  (less control over an already-small server); point-in-time recovery (worth it later, not at
  this volume).
- **Consequences:** deploying now requires the build step, and absolute redirects must account
  for the path prefix. Per-IP rate limiting belongs at the edge and is only partly solved —
  see the roadmap.
- **Revisit when:** more than one node is needed, which the in-memory MCP sessions currently
  prevent, or point-in-time recovery becomes worth it.

---

<a id="adr-0028"></a>

## ADR-0028 · Pluggable transactional email (`log | brevo | smtp`)

- **Status:** accepted (2026-09-09).
- **Context:** the one-time code is the only door into the product, and it could only leave
  through one specific provider: the endpoint was wired in, the default sender belonged to one
  company, and there was no way to use anything else. An operator without an account there
  could not authenticate anybody. Worse, the failure surfaced late: with no API key the system
  simply printed the code to the console — which in production is a silent security failure
  dressed up as "development mode".
- **Decision:** an `EmailSender` interface in `@cortex/core` with three implementations: `log`
  (prints, does not send; the default when nothing is configured), `brevo`, and `smtp` with a
  lazy import so only those who use it pay for it. Selected by `CORTEX_EMAIL_PROVIDER`, sender
  in `CORTEX_EMAIL_FROM`, and `setEmailSender()` for tests. `validateEmailConfig()` runs **at
  server startup**: it throws if the chosen provider cannot work, and warns if production is
  only logging codes.
- **Why the choice lives in core rather than the entrypoints**, unlike the classifier, reranker
  and reconciler: the only consumer is `requestOtp`, in this same package, and the choice is
  pure configuration with no external dependency. Threading it through four entrypoints would
  be ritual without gain; the injection point that is genuinely needed — tests — is covered by
  `setEmailSender`.
- **Consequences:** core gains a dependency, loaded only on the SMTP path. The exact line the
  `log` mode prints is **fixed by tests**: the integration tests for the auth flow read the
  code from it.
- **Revisit when:** there is more mail than the one-time code, which means templates and
  translations, or sending needs a queue and retries.

---

<a id="adr-0029"></a>

## ADR-0029 · Apache-2.0, and the minimum governance to open the code

- **Status:** accepted (2026-09-10).
- **Context:** no licence, no security policy, no templates. Without a licence, "public" means
  "all rights reserved": nobody can legally use it, so this is the first thing to settle.
- **Decision: Apache-2.0.** The licences of every direct dependency were checked one by one —
  Apache-2.0, MIT, BSD-2, ISC and Unlicense. None is copyleft, so Apache-2.0 is compatible with
  all of them. Against MIT it adds two things that matter here: an **express patent grant**,
  with a termination clause if someone sues, and a **trademark clause** stopping a third party
  from using the name to endorse a fork.
- **Governance:** a security policy with a stated response time and an explicit scope,
  Contributor Covenant 2.1, issue and pull request templates carrying the contributing
  checklist, weekly dependency updates grouped by severity, and a changelog in Keep a Changelog
  format.
- **`pnpm audit` in CI: informational, not blocking.** There are high-severity advisories, and
  **all of them are transitive** through three upstream packages. None is our code and none can
  be fixed until those projects publish. A gate that is red from day one gets switched off or
  ignored, and then it protects nothing. It stays visible on every build instead.
- **A spreadsheet dependency is pinned to its vendor's CDN** rather than npm, because the npm
  release is abandoned and carries two unfixed advisories. Same API, no code changes.
  **Trade-off accepted:** automated updates do not follow tarball URLs, so it needs a manual
  check each quarter — written into the security policy and the update configuration so it is
  not forgotten.
- **Alternatives:** MIT (equally compatible, but no patent grant and no trademark protection);
  replacing the spreadsheet dependency (a ten-line port, but a heavier dependency for no gain
  today); AGPL or BSL (would slow adoption, with no business model to justify it).
- **Revisit when:** a commercial model calls for a different licence, an outside contributor
  asks for a contributor agreement, or the upstream advisories clear and the audit can block
  for real.

---

<a id="adr-0030"></a>

## ADR-0030 · A compiled build with `tsc -b`, and dual exports so development stays instant

- **Status:** accepted (2026-09-10).
- **Context:** there was no build step: everything ran from source, and each package's
  `exports` pointed at `./src/index.ts`. Comfortable to develop, and it blocked three things at
  once — the CLI could not be published as an installable package, the Docker image had to
  carry development dependencies and transpile on every start, and type errors showed up in
  production instead of at build time.
- **Decision:**
  1. **`tsc -b` with project references.** Every package and server app gets a
     `tsconfig.build.json` (composite, emitting to `dist`), with a root one orchestrating them.
     The existing `tsconfig.json` files are **left alone** as typecheck-only. Keeping them
     separate is what avoids the "output file has not been built" error when type-checking a
     project that has references.
  2. **Dual `exports` with a `development` condition.** Each package exposes
     `development → ./src/index.ts` and `import → ./dist/index.js`. Development scripts launch
     with `--conditions=development`, so **developing still needs no build**, while production
     resolves to the compiled output. Typecheck and tests work on a fresh clone with no `dist/`.
  3. **`tsc`, not a bundler,** for packages and server apps: it preserves the directory
     structure, and three paths to data files depend on that — the SQL migrations, the web
     app's static files, and the installer script. A flat bundle breaks them silently. The CLI
     *is* bundled, because there the goal is a single distributable artefact.
  4. **Environment loading stops resolving `.env` relative to its own source file.** That tied
     the function to living at a particular path and broke once compiled. It now looks at an
     explicit variable, then the workspace root, then the working directory.
  5. **The migration runner stops running on import.** It becomes a function plus a thin CLI,
     so a server or a test can migrate without inheriting a `process.exit`.
- **Alternatives:** *keep running from source in production* — slower starts, development
  dependencies in the image, type errors at runtime; *bundle everything* — breaks the data-file
  paths for no gain on server processes; *one tsconfig per package for both build and
  typecheck* — precisely what causes the error in point 1.
- **Consequences:** the Dockerfile builds and runs the compiled output. Anyone touching how a
  data-file path resolves must build and check: CI has a smoke test for it, because neither the
  typecheck nor the tests catch that class of failure.
- **Revisit when:** a dependency becomes ESM-only and forces resolution to be revisited.

---

<a id="adr-0031"></a>

## ADR-0031 · What gets published and what does not: opening the code is not opening the process

- **Status:** accepted (2026-09-10).
- **Context:** while preparing to open the repository, an **operational** decision slipped into
  a decision record — which key backs the server and why that risk was accepted. That is not
  product documentation: it is how one company operates, it helps nobody using Cortex, and it
  exposes arrangements with third parties. The incident revealed the underlying gap: there was
  no written criterion for which documentation is product and which is process.
- **Decision: publish the product and what is needed to understand and operate it; keep the
  internal process out.**

  **Belongs in the product repository:**
  - Code, tests, README, contributing guide, security policy, licence, code of conduct,
    changelog.
  - **Design decision records**: why pgvector rather than a dedicated vector database, why
    hybrid search, why bi-temporal, why the provider is generic. They explain *how it is built*
    and are part of the value of opening it.
  - Configuration documentation: which variables exist and what they do.
  - Technical research of general interest, as long as it does not depend on our data.

  **Does not belong here** (it lives in the private repository):
  - **Operational decisions**: which provider, which key, which quota, what cost, what
    agreements. The product documents *how to configure it*, not *what our deployment is
    configured with*.
  - **Security audits and refactor plans** with findings per file. Even resolved, they are a
    map of where the problems were.
  - **Business priorities and owners**: who does what, in what order.
  - Named clients and anything of theirs, already covered by [0026](#adr-0026).

- **The rule to apply in the moment:** if a paragraph helps somebody outside **use, understand
  or improve Cortex**, it is public. If it describes **how we operate it or what we have
  agreed with whom**, it is not. When in doubt, keep it out: publishing later is easy,
  unpublishing is not.
- **Alternatives:** build fully in public — transparency at the cost of exposing third-party
  arrangements, security audits and commercial priorities, with no gain for whoever uses the
  product; publish no decision records at all — losing exactly the part that makes the
  technical work credible.
- **Consequences:** this record doubles as the checklist for what must stay out. A test watches
  for the most common leak — describing the rig a finding came from rather than the finding.
- **Revisit when:** a kind of document appears that does not fit cleanly in either column.

---

<a id="adr-0032"></a>

## ADR-0032 · Per-agent integration: a Claude Code plugin and `cortex setup`, not one installer

- **Status:** accepted (2026-09-10). Supersedes the previous install model — symlinks into a
  clone, hand-written hooks, and a shim on the PATH.
- **Context:** connecting an agent used to be a side effect of installing: you cloned the
  monorepo and the installer left symlinks pointing into the clone, hooks referring to its
  path, and a shim in the PATH. All of it breaks the moment the clone moves, is deleted or
  falls behind, and none of it can be repaired without going through the clone again. Claude
  Code already has its own mechanism for this — plugins, which a user can see, update and
  disable — and we were not using it.
- **Decision:**
  1. **Installing the package and configuring the agents are two separate operations.**
     Installing puts the CLI on the PATH; `cortex setup <agent>|--all` touches configuration,
     as many times as needed, without reinstalling anything.
  2. Cortex ships itself into Claude Code as a **plugin** — hooks, MCP, the capture skill and
     the save command in one versioned package, with the marketplace declared in this
     repository.
  3. If the plugin cannot be installed, it **falls back** to writing hooks into settings, and
     the result works the same. A flag forces that mode.
  4. Each agent is integrated through **its own** native mechanism rather than a lowest common
     denominator. One other agent reads the same marketplace and accepts the same plugin, so
     they share the package. The rest get a plugin, an extension or hooks in their own
     configuration format. Because the plugin is shared, the capture hook does **not** hardcode
     which agent it is running under: it works that out from the transcript path.
  5. Every write is idempotent, backs up any file it did not create, can be undone with
     `--remove`, and shows its plan with `--dry-run`.
- **Migrating the old setup, inside `setup` itself:** old hooks are **replaced in place** —
  adding one alongside would distil every session twice — the MCP registration is rewritten,
  because the old one talked to Postgres directly with no permissions, symlinks are removed
  since the plugin supplies them, and the shim is deleted so it cannot win over the installed
  binary. The old clone is **not** deleted: it may hold a `.env` with keys and unpushed
  branches.
- **Alternatives:** *keep the old installer* — it ties the installation to a clone; *plugin
  only* — excludes anyone without access; *hooks only* — works, but is invisible to the user
  and never updates itself; *our own config format for every agent* — none of them would read
  it.
- **Consequences:** the plugin carries its own version, which must move with the product's.
  Having both plugin and hooks would capture twice; `setup` prevents it and `--status` reports
  it.
- **Revisit when:** Claude Code changes its plugin format, or another agent ships an equivalent
  mechanism that lets its adapter be retired.

---

<a id="adr-0033"></a>

## ADR-0033 · Several Cortex servers at once: the server belongs to the repository

- **Status:** accepted (2026-09-11).
- **Context:** the client only knew how to talk to one server. Credentials were a single
  `{server, token, email}`, and everything else followed from it. For somebody working with one
  organisation that is correct and still is. But a freelancer with two clients, or a consultant
  whose client runs their own Cortex, needs both on the same machine at the same time. Switching
  the session by hand is not a solution: it is precisely how one client's knowledge ends up on
  another's server.
- **Decision:** the server is a **property of the repository**, not a global mode to toggle.
  1. `.cortex.json` accepts a `server` field; absent means the default, which is almost
     everyone.
  2. Credentials become a map keyed by server, still reading the old format so nobody has to
     sign in again.
  3. Hooks, CLI and the MCP proxy resolve the server from the working directory **before**
     touching the API.
  4. The token is looked up **per server**: sending somebody else's would be a baffling 401 at
     best, and a request to the wrong place at worst.
  5. With more than one session, creating a project **requires** saying which server, because
     it is the one point in the flow where a client's project can be created on another
     client's server without anyone noticing afterwards.
- **Why the repository and not a global mode:** writing is what must not go wrong, and whoever
  writes always knows the working directory. A global mode depends on a person remembering
  which one they are in; the repository depends on nobody. And `.cortex.json` was already the
  opt-in gate, so this adds a field to an existing concept rather than a new concept.
- **Alternatives:** a separate home directory per client — already possible and useless, because
  hooks are launched by the agent without that variable; multi-tenancy on the server — solves a
  different problem, costs an order of magnitude more, and does not help when the other server
  belongs to somebody else.
- **Consequences:** outside a linked repository the MCP connects to the default server. Tools
  still ask for the project by name and permissions still apply, so the worst case is a query
  against the wrong memory, never a write.
- **Revisit when:** two projects from different servers are needed in one folder — impossible by
  design today, and probably should stay that way — or the server grows real organisations.

<a id="adr-0034"></a>

## ADR-0034 · Memory as tools with a name of their own, and an API that can read

- **Status:** accepted (2026-09-11).
- **Context:** the harness we run on one agent decides whether it can store its artefacts by
  checking whether a memory tool exists among the active ones. It does not call any particular
  memory system or import one — it just looks at the name. The idea was to register ours so
  Cortex could fill that slot without touching anybody's code.

  Checking before writing anything turned up two things. First, that agent resolves name
  collisions by keeping the **first** extension that registers a name, and does so **silently**;
  standalone extensions load before packages. A plain `mem_save` from us would have made another
  memory's tools unreachable without a word. Second, the check accepts `mem_save` **or any name
  ending in `.mem_save`**, so a prefix costs nothing.

  A third problem surfaced underneath: **the API could write but not read.** Search existed only
  through MCP, against the database, which left out the CLI and any integration without MCP.
- **Decision:**
  1. Tools are registered as `cortex.mem_save`, `cortex.mem_search`,
     `cortex.mem_get_observation` and `cortex.mem_update`. Prefixed, they coexist with any other
     memory, and the harness still finds them.
  2. The API gains reading: search (scoped to what the caller can see when no project is given),
     fetch by id, and a narrow update of title and content — type, confidence and validity are
     decided by reconciliation and the lint, not by the caller.
  3. The bridge is a CLI command, so the extension does not speak HTTP itself and the resolution
     of server and token stays in one place ([0033](#adr-0033)).
  4. Ids are Cortex's own. Because the tools live in their own namespace, they never get mixed
     up with another memory's.
- **Alternatives:** expose the tool from the MCP server — does not work, that host names MCP
  tools with an underscore, which fails the check; register the bare name and ask people to
  uninstall the other memory — forces a choice that is not ours to impose; have the extension
  talk HTTP directly — duplicates credential and project resolution inside a generated file.
- **Consequences:** a project can have two memories at once without either shadowing the other.
  The read API opens a new surface, which is exactly where somebody else's private project
  leaks: the guards are tested one by one, including search without a project.
- **Revisit when:** that host warns about collisions instead of swallowing them, so the prefix
  becomes optional; or the search API needs pagination.

<a id="adr-0035"></a>

## ADR-0035 · Contradictions are flagged in the context pack, not resolved automatically

- **Status:** accepted (2026-09-11).
- **Context:** with several agents working on one project, two recorded incompatible decisions
  about the same thing, because one read the code before the other changed it. Maintenance
  detects the contradiction and the lint reports it, but nothing invalidates anything: the
  context pack went on serving both as current without saying they clashed.

  What settled it: two different agents spotted it **on their own** at startup and said so
  without being asked. If they can see it, the information is needed — and if we do not give it
  to them, each one spends reasoning rediscovering it.
- **Decision:** the pack carries the contradictions affecting its entries, and the warning is
  attached **to each entry involved**, not to a section at the end — by the end, the reader has
  already believed the entry.

  Two shapes, because two different things are known. Between **entries** — what reconciliation
  creates — the pair is named along with which was recorded first. Between **entities** in the
  graph — what maintenance creates, and the common case — it says only that **that corner is
  disputed**, because an entry attached to a document does not necessarily contradict whatever
  that document clashes with. Asserting the specific pair produced absurd warnings, and a
  warning that lies teaches people to ignore all warnings.
- **What it deliberately does not do:** invalidate either side or pick a winner. Which one is
  wrong is a judgement that gets made badly in the automatic case, and deleting the good one
  costs far more than reading a warning. Age is given as a fact, not a verdict: newer does not
  mean right.
- **Alternatives:** invalidate the older one automatically — no, the contradiction is detected
  by a model after the fact and can be wrong, and one side may be curated; hide the older side —
  the same, and silently; leave it in the lint only — nobody reads that while working, which is
  when it matters.
- **Consequences:** the pack grows when there are conflicts, which is exactly when it should.
  An entry attached to **both** sides of a dispute gets no warning: it is not caught in the
  argument, it is the argument. Somebody still has to close the conflict; the warning is so
  nobody decides blind in the meantime.
- **Revisit when:** the reconciler becomes reliable at resolving contradictions, and could
  propose a winner.

---

> The records below were made on the dates shown but never numbered, so nothing could cite them.
> They were given identifiers on 2026-09-12. See the note in the index.

<a id="adr-0036"></a>

## ADR-0036 · Linking a repository to a project: a slug, and a server-side gate

- **Status:** accepted (2026-06-24).
- **Decision:** a repository is linked to a project through a `.cortex.json` holding a **slug**:
  unique per project, stable, **independent of git**, assigned by Cortex when the project is
  created.
- **Why a slug and not the git remote:** git is not a reliable identity. A repository can be a
  monorepo (one remote, several logical projects), a folder containing several git repositories,
  or not cloned at all. A slug is explicit and handles all three.
- **The gate runs the other way — linking is not creating:** hooks resolve slug → project
  through a function that **does not create**. If the slug does not exist, or the file opts out,
  or there is no file, **nothing flows**. Creating and linking is deliberate.
- **Permissions:** the project becomes a managed entity with an owner and members. The gate —
  resolve the slug, does it exist, is it allowed — is the natural place for access control, and
  is what [0046](#adr-0046) later unified.
- **Revisit when:** saving through MCP or a connector should also require slug and permission.
  Today the gate covers the hooks, which are the automatic and therefore riskiest path.

<a id="adr-0037"></a>

## ADR-0037 · A project hierarchy, with inheritance and cascading permissions

- **Status:** accepted (2026-06-24).
- **Decision:** a project can have a **parent**. The typical case is a client with several
  repositories. Each child is a **real project** — its own slug, link, permissions and retrieval,
  which is what keeps retrieval precise — and the parent groups them and holds the shared
  context.
- **Context inheritance:** a child's context pack includes its own entries **plus its ancestors'**,
  through a recursive query. Shared knowledge reaches every child without mixing the children's
  contexts with each other, which is the failure mode of putting everything in one project.
- **Permission cascade:** access walks the ancestor chain. If the project or any ancestor is
  private, access is restricted; being owner or member of **any ancestor** grants it.
- **Why not one project with subfolders:** retrieval precision would go — a session in one
  repository would pull the other's context — along with per-repository linking and fine-grained
  permissions. Why not flat: the shared part would be siloed or duplicated.
- **Revisit when:** inheritance is wanted in search and ask too, not only in the pack.

<a id="adr-0038"></a>

## ADR-0038 · Opening the web UI with a single-use ticket, never the token in a URL

- **Status:** accepted (2026-06-24).
- **Decision:** `cortex ui` does not open the browser with the long-lived token in the URL,
  where it would end up in history, logs and referrers. It asks the server for a **short-lived,
  single-use ticket** and opens a URL carrying that instead. The web app **redeems** it — an
  atomic update marking it used — for a **new browser session** distinct from the CLI token.
  The CLI token never reaches the browser.
- **Verified:** the cookie is not the CLI token; reusing a ticket returns 401; redemption is
  atomic, so a ticket works exactly once.

<a id="adr-0039"></a>

## ADR-0039 · MCP over authenticated HTTP, alongside stdio

- **Status:** accepted (2026-06-24).
- **Decision:** the MCP server stops being stdio-only. An HTTP transport is added, sharing the
  same tool definitions, so the same server can be reached from a machine without a database.
- **Auth:** the endpoint requires the **same bearer token** as the API; no token, no service.
  Sessions are held in memory, one server instance per session.
- **Identity reaches the tools:** the HTTP server is built **with the user**, so tools attribute
  writes to that email and apply that user's project permissions, exactly as the hooks and
  connectors do. A session is tied to its user, so another token cannot reuse its session id.
- **Verified:** no token gives 401; initialising returns a session; someone else's private
  project is denied; a save is attributed to the right email.
- **Revisit when:** sessions need to survive across nodes, which is what currently pins the
  deployment to one.

<a id="adr-0040"></a>

## ADR-0040 · A docker-compose deployment: one image, one command per service

- **Status:** **superseded** (2026-09) by [0027](#adr-0027), which compiles the image, publishes
  it, and puts it behind TLS with health checks and backups. What still stands from here is the
  shape: **one image** for every service, and migrations as a service that runs first and exits.
- **Decision:** a deployable stack with Postgres, a migration step the others wait on, the API,
  the web UI, the MCP endpoint and a maintenance worker. A **single image** reused by all of
  them; each service supplies its own command.
- **Revisit when:** it goes behind a real proxy with TLS, or the image should be compiled rather
  than run from source — both of which is what [0027](#adr-0027) did.

<a id="adr-0041"></a>

## ADR-0041 · Refactoring the architecture in phases, not redesigning it

- **Status:** accepted (2026-07-03). Completed.
- **Decision:** after an architecture review, refactor **incrementally in phases** — risk
  patches and unifications, then entrypoints out of the library packages and core without LLM,
  then testable apps, then internal splits and pruning. **No redesign:** the package graph was
  healthy and the dependency inversion for the LLM was already the right pattern. It gets
  completed and then protected by written dependency rules.
- **Deliberately rejected**, as over-engineering for a product that is still a hypothesis:
  tactical DDD with formal repositories, an ORM or query builder, a dependency-injection
  container, a service layer between handlers and core, a frontend framework, microservices, a
  migration framework, and fixed-dimension vector indexes. At most one new package.
- **Discipline:** one pull request per step, with typecheck and both test suites green, and the
  bar for each step being "this removes a bug or a class of bugs".
- **Why:** the prototype was built in days, and its real problems were local — mixed entrypoints,
  duplication carrying functional bugs, side effects on import, oversized files — not skeletal.
  Every extra abstraction has to justify its cost.

<a id="adr-0042"></a>

## ADR-0042 · The UI stays server-rendered, with written thresholds for changing that

- **Status:** accepted (2026-07-03).
- **Decision:** the web UI stays **server-rendered** and gets structured: an app factory, routes
  per resource, views with an auto-escaping template helper — which removes a whole class of
  cross-site-scripting bug that manual escaping had already let through once — and static files
  served normally. **No** single-page application, no meta-framework.
- **The web app and the API are not merged,** and the web does not consume the JSON API: they
  serve different clients, browser with a cookie against CLI with a bearer token, and both are
  thin consumers of core. Their real duplication is removed by extracting shared helpers, not by
  coupling two deployments.
- **Why:** every interaction today is a form submission with a full reload, plus one island of
  JavaScript. A single-page app would mean duplicating about fifteen core operations as a JSON
  API, browser auth, a build and a second deployment — a permanent cost for no present benefit.
- **Thresholds, written down so the decision is not re-litigated on impulse:** partial updates
  when the first genuine partial refresh is needed; a client framework only if the graph becomes
  an interactive explorer with client state, or the UI stops being internal.
- **Revisit when:** either threshold is crossed, or a second consumer appears that needs a JSON
  API anyway.

<a id="adr-0043"></a>

## ADR-0043 · One canonical way to resolve a project by name

- **Status:** accepted (2026-07-03).
- **Decision:** resolving a project by name uses **one** function with **canonical** semantics —
  lowercased, unaccented. Six copies were removed, two of which compared the name **exactly**.
- **Why it mattered:** those two were in deduplication and batch capture. A caller using a
  different capitalisation silently got no match, so reconciliation never fired and every
  capture became a new entry. The memory filled with duplicates and nothing reported an error.
  There is an integration test demonstrating it.
- **Intended behaviour change:** captures that used to fail deduplication on spelling now
  reconcile.
- **Revisit when:** resolving by slug and by name needs to happen in one function. **Reached**
  (2026-09-16): see [0061](#adr-0061).

<a id="adr-0044"></a>

## ADR-0044 · Credentials and the HTTP client unified in `shared` — a deliberate exception

- **Status:** **superseded** (2026-09) by [0025](#adr-0025). What was decided here — one copy of
  the credentials parser and the HTTP client instead of four — still stands; what changed is
  **where** it lives.
- **Original context:** there were four credential parsers with three different interfaces, and
  the HTTP client sat inside core with the dependency pointing the wrong way. They were unified
  into `shared`, knowingly accepting an exception to "shared does no I/O", with a note that if it
  grew it should become its own package.
- **What happened:** it grew. Preparing the distributable CLI needed session transcripts and the
  link file there too, and `shared` is imported by **everything**, including the server. The
  exception was paid off by extracting a client package, and `shared` went back to being types,
  contracts and pure functions.

<a id="adr-0045"></a>

## ADR-0045 · Multimodal extraction behind a hook, so core stays free of the LLM

- **Status:** accepted (2026-07-03).
- **Decision:** core's extraction keeps only the **deterministic** part — documents with a text
  layer, spreadsheets, diagrams. Image captioning, OCR of scanned PDFs and audio transcription
  live in the agents package and are **injected**, the same pattern as the classifier, reranker
  and reconciler. Without the hook, those formats return nothing, exactly as they did before
  without keys.
- **Why:** it was the last violation of "core is deterministic, no LLM", which is a rule the
  repository states out loud. The hook pattern already existed, so this adds no new concept.
- **Behaviour note:** the vision configuration is now resolved **once** at wiring time rather
  than per call.
- **Revisit when:** a vision or speech provider needs configuration that differs from the chat
  model's.

<a id="adr-0046"></a>

## ADR-0046 · One access policy, and "does not exist" means denied

- **Status:** accepted (2026-07-03).
- **Decision:** access control lives in **one** place, returning a discriminated `ok |
  not_found | forbidden` that each layer translates into its own idiom. The policy for something
  that does not exist is **not found — denied**.
- **Why it mattered:** three semantics coexisted. The web was **fail-open**, MCP let it through,
  and the API returned 404. One of those three is a data leak, and it is not obvious which from
  reading any single call site.
- **Deliberate exception:** saving by project name treats "not found" as "the project will be
  created", which is existing product behaviour; "forbidden" still denies.
- **Observable changes:** a query with a typo now returns 404 instead of quietly listing nothing.
  A related bug was fixed in passing: with auth disabled, a synthetic empty user was denying
  **every** private project.
- **Revisit when:** saving through MCP or the web requires slug and permission.

<a id="adr-0047"></a>

## ADR-0047 · Searching without a project is scoped to what you can see

- **Status:** accepted (2026-07-06).
- **Decision:** search and ask accept an option restricting them to the projects a given user can
  access. Without a specific project and with that option present, results are limited to those
  ids — default-deny; a null user means public projects only. With a specific project the access
  guard already applies. Without the option at all — a trusted local call — nothing is
  restricted.
- **Why it mattered:** this closed a leak. Searching without a project from the HTTP MCP endpoint
  or the web returned entries from **other people's private projects**.
- **Implementation detail worth keeping:** entries with no project are excluded from a restricted
  search, and an empty id list returns nothing rather than everything — fail-closed in both
  directions. The code distinguishes "do not restrict" from "restrict to public" by testing for
  the **presence** of the option, not its truthiness, because a falsy check would collapse the
  two into the dangerous one.
- **Revisit when:** legitimately global entries appear that users should be able to search.

<a id="adr-0048"></a>

## ADR-0048 · Metrics in a standard format, not a dashboard of our own

- **Status:** accepted (2026-09-14).
- **Context:** the health checks answer "is the service responding", and that leaves out the
  two failures that actually hurt here, because the service keeps responding while both
  happen. The **maintenance worker** can die — it has no port, so nothing external notices, and
  it is what keeps the memory alive through enrichment, reconciliation and the lint; the memory
  then degrades slowly and silently. And **captures can start failing** — they sit in the table
  marked failed, the agents carry on working, and nobody notices until somebody wonders why the
  memory has not grown in weeks.

  The question behind this, asked well: whatever gets built has to be generic, because this is
  a product other people deploy.
- **Decision:** expose `GET /metrics` in the **Prometheus text format**. Not a dashboard of our
  own.

  A dashboard has to be looked at, and nobody looks at a dashboard on a good day. A standard
  format is read by whatever the operator already runs — Prometheus, Grafana Agent, Datadog,
  anything — and lets **them** set their own thresholds on their own schedule. It is plain
  text, so it adds no dependency to the product.

  What it exposes is deliberately about the system, not about a request: captures by status,
  the age of each portless process's heartbeat, current entries, projects, and inference calls
  and tokens. The worker now also beats into the database, because the file it was writing
  lives inside its own container where only its own health check can see it.

  **Off unless configured.** It needs `CORTEX_METRICS_TOKEN`, and without a valid one the
  endpoint answers 404 rather than 403 — a 403 would announce that there is something worth
  asking for. These numbers say how much a deployment is used and how much it spends.
- **Alternatives:** a status page in the web UI — has to be looked at, and it would only serve
  this product; pushing to a specific provider — picks the operator's tooling for them, which
  is exactly the thing to avoid; OpenTelemetry for metrics too — heavier for what is currently
  a handful of numbers, and the trace side already has its own exporter ([0016](#adr-0016)).
- **Consequences:** an operator who wants alerts now has something to point at, and one who
  wants none loses nothing. Per-request metrics — latency, status codes — are **not** here yet;
  the natural place is a middleware feeding the same endpoint, and it is on the roadmap.
- **Revisit when:** per-request metrics are wanted, or enough deployments want OpenTelemetry
  that maintaining one format stops being simpler than maintaining two.

<a id="adr-0049"></a>

## ADR-0049 · The context pack is budgeted per section, not cut at the end

- **Status:** accepted (2026-09-15).
- **Context:** the session-start hook injects the project's context pack and has a character
  limit, because a system prompt is not free. The limit was applied as a `slice()` on the
  rendered pack: take the first N characters, drop the rest.

  On a project with two hundred entries that turns out to mean something quite different from
  "a shorter pack". Measured on a real one — 28,389 characters across five sections — the
  6,000-character cut delivered part of **Decisions in force** and nothing else. Constraints,
  risks, technical debt and conventions never reached the agent at all. Not trimmed: absent.

  That is the worst shape a failure can take here, because nothing announces it. The agent is
  told it has the project's living memory, the pack looks well-formed, and a whole class of
  knowledge — exactly the class that stops someone breaking something — is silently missing.
  A section that isn't there reads as "there is nothing of that kind in this project".
- **Decision:** the **server** renders within a budget the caller asks for
  (`GET /context-pack?maxChars=`), instead of the caller cutting what it receives.

  The budget is shared out between sections rather than spent in order: each gets an equal
  share, whatever a section doesn't need goes back into the pot for the others, and then the
  remainder is spent top-down by importance. Every section that has entries appears, and each
  one says how many it left behind (`…and 15 more here. Ask Cortex for the rest.`) so the
  agent knows the difference between "no constraints" and "constraints you haven't been
  shown", and knows to ask.

  Ordering changed with it. Entries came out `created_at DESC`, which after a backfill is no
  order at all — everything was created within the same minute, so the twenty that survived a
  cut were arbitrary. They now come out by confidence first: if the pack has to be shortened,
  what survives is what the system trusts most.

  The hook still slices what it gets, as a net. It is no longer how the pack is shortened.
- **Alternatives:** raising the limit — the pack grows with the project, so it only moves the
  cliff; summarising with an LLM at session start — latency and cost on every session, for
  content that is already summaries; sending only the sections the agent asks for — the agent
  doesn't know what it doesn't know, which is the whole point of injecting context.
- **Consequences:** an agent starting a session on a large project now sees less of the
  decisions than before and something of everything else, which is the trade this is making
  deliberately. Callers that want the whole pack (the MCP tool, the web UI) pass no budget and
  get it whole.
- **Revisit when:** ranking within a section wants to be relevance-based rather than
  confidence-based (it needs the session's topic, which the hook does not have yet), or a
  section proves to deserve a different weight than an equal share.

<a id="adr-0050"></a>

## ADR-0050 · The web UI is organised around the project, and its job is audit and repair

- **Status:** accepted (2026-09-15). Design in [`design.md`](design.md).
- **Context:** the web UI was the one part of Cortex whose job was never written down. It
  grew into eight top-level screens on a flat navigation bar, each with its own project
  selector, none remembering which project you were looking at. Meanwhile almost everything
  in the memory is written by agents; nobody types entries. A full pass over the running UI
  (2026-09-15) found the screens that matter most for that reality — the lint report and the
  context pack — were the ones that offered nothing to do: text without links, findings
  without actions. And the landing page, with no project selected, rendered empty on a
  database with hundreds of accessible entries ([0052](#adr-0052)).
- **Decision:** two things, one about purpose and one about shape.

  **Purpose.** The web is where a person **audits and repairs a memory written by machines**.
  Not a data-entry tool, not a dashboard, not the primary way anyone uses Cortex. Three rules
  follow: reading beats writing; nothing is shown without a way to act on it; anything that
  wants a terminal stays in the terminal (`cortex-admin`, the CLI).

  **Shape.** The project is the unit of everything — of access, of context packs, of what a
  developer has in mind when they open the UI — so the UI is organised around it. The landing
  page lists the projects you can reach. A project has one address, `/p/<slug>`, and its
  sections are tabs on that page: what the memory holds, ask, what agents see at session
  start, health, map, code, and settings for whoever manages it. The project is in the URL,
  so it cannot be lost by navigating. Global search is the one thing that lives above
  projects. Operator screens (usage and cost) sit in an admin area, visible only to admins.
  Old URLs redirect.
- **Alternatives:** keep the flat navigation and add a sticky project cookie — fixes the
  symptom, keeps the eight-way split and the per-screen selectors; a client-side app — ruled
  out by [0042](#adr-0042), and nothing here needs it.
- **Consequences:** every project needs a slug to have an address, which [0051](#adr-0051)
  guarantees. Section labels are chosen for a person, not for the internals: "Health" rather
  than "Lint", "What agents see" rather than "Context pack". The design document owns the
  detail and the list of known gaps; this record owns the decision.
- **Revisit when:** a second kind of user appears whose unit is not the project — a
  client-level view across projects, say — or the number of sections makes tabs the wrong
  control.

<a id="adr-0051"></a>

## ADR-0051 · A project has a life after creation: visibility, owner and members are managed, and every project has a slug

- **Status:** accepted (2026-09-15).
- **Context:** [0036](#adr-0036) gave projects an owner, members and a visibility, and
  [0037](#adr-0037) made permissions cascade down the hierarchy. What neither said — and what
  turned out to be missing entirely — is how any of it changes afterwards. The only
  `UPDATE … visibility` in the repository runs at creation. There is no domain function, no
  endpoint, no command and no screen that changes a project's visibility or owner. Members can
  be managed only by a global admin, and only through a block that appears when the project is
  already private — so on a deployment where every project was born public, the block has
  never been shown. Projects that `save` creates on the fly have no slug, no owner and are
  public; the CLI already knows they exist and lists them as unlinkable.

  The effect from the outside is "there is no way to manage public and private projects", which
  is very nearly true.
- **Decision:**
  1. **Managers.** A project is managed by its **owner** or by a **global admin**. Managing
     means changing visibility, transferring ownership, and adding or removing members. Members
     stay binary (no roles): the case for roles has not appeared.
  2. **Visibility is mutable**, both ways. Going private hides the project from everyone but
     its managers and members, immediately, including in packs and search; going public does
     the reverse. Neither touches the entries.
  3. **Every project has a slug.** A migration backfills slugs for projects that have none,
     from their name, disambiguating collisions with a short suffix. Projects that `save`
     creates go through the same path as `cortex link --create`: they get a slug and are
     **owned by whoever saved**. Nothing is born ownerless from now on.
  4. **Existing ownerless projects** are shown as unclaimed; an admin assigns an owner.
  5. The operations exist as domain functions guarded by a single `canManageProject`, are
     exposed on the HTTP API (`PATCH /projects/:slug`, `/projects/:slug/members`), and in the
     web under the project's Settings section — visible to managers regardless of visibility.
- **Alternatives:** per-project roles (owner/maintainer/member) — more than anyone has asked
  for; keep member management admin-only — makes the global admin a bottleneck for every team,
  which is exactly what an owner is for; leave `save`-created projects ownerless — keeps
  producing the orphans this record exists to stop.
- **Consequences:** an owner can lock a project that others were reading; that is the point,
  and the UI says who to ask. `listAccessibleProjects` and every gate keep working unchanged
  because the policy ([0046](#adr-0046)) does not move — only the data it reads can now
  change. The CLI gains nothing in this batch beyond what the API makes possible; a
  `cortex project` command is the obvious follow-up.
- **Revisit when:** someone needs a member who can read but not validate, or a project needs
  more than one owner.

<a id="adr-0052"></a>

## ADR-0052 · Access scoping happens in the query, never after a limit

- **Status:** accepted (2026-09-15).
- **Context:** the dashboard asked the database for the sixty most recent entries across all
  projects and then dropped the ones the viewer could not see. On any database where the
  sixty newest happen to belong to projects the viewer cannot reach — or to no project — the
  page is empty while hundreds of accessible entries exist. Measured on a local copy: 452
  accessible entries, 0 shown. It is the first screen of the product.

  [0047](#adr-0047) had already made the same move for search, for a different reason
  (leaking other people's entries). This is the mirror failure: filtering late does not leak,
  it hides.
- **Decision:** any listing that a viewer sees is scoped to what the viewer may see **inside
  the query**, before ordering and limiting. `listEntries` takes the set of accessible project
  ids (and whether project-less entries are included, which the access policy says they are —
  an entry with no project is readable by anyone signed in) and applies it in SQL. No caller
  filters a limited result set in memory for access. A test asserts the dashboard shows
  entries when accessible ones exist beyond the newest N.
- **Alternatives:** raise the limit — moves the cliff; filter first then limit in memory —
  reads every entry to show sixty.
- **Consequences:** one more parameter on `listEntries`; callers that want "everything, as
  admin" pass no scope explicitly rather than by omission, so the default is the safe one.
- **Revisit when:** listings are paginated (the same rule applies to cursors) or a listing
  needs to span visibility boundaries for a legitimate reason.

<a id="adr-0053"></a>

## ADR-0053 · A design system in one stylesheet, and no CSS framework

- **Status:** accepted (2026-09-15).
- **Context:** the UI rework ([0050](#adr-0050)) moved every screen around and left the styling
  behind. Screens were assembling their own markup, so the same idea — a card, a panel, a
  warning — came out slightly different in each place and the whole thing read as if four
  people had built it without talking. The reasonable question came up: should this use
  Tailwind, build components, and look professional?

  Two separate things were wrong, and only one of them is about tooling.

  First, a bug that made it look far worse than it was: `/styles.css` is served with no
  `Cache-Control` and no `ETag`, only `Last-Modified`. Browsers apply heuristic freshness to
  that and keep the old copy without asking. Anyone who had opened the UI before a deploy saw
  new markup with the previous stylesheet — a half-painted page that looks exactly like a
  broken redesign.

  Second, the real one: there was no scale and no component layer. Spacing values were picked
  per screen, there were two shades of grey doing the same job, and `views/` held four helpers
  while the routes wrote raw HTML.
- **Decision:** **no CSS framework.** One stylesheet, organised as a design system: tokens
  (one accent, a five-step ink ramp, a spacing scale in multiples of four, a type scale of six
  sizes), then base, layout, components, screens, responsive. Plus a real component layer in
  `views/components.ts` — `panel`, `empty`, `warn`, `entryCard`, `hitCard`, `searchForm`,
  badges — that the routes **compose** instead of hand-writing markup.

  Tailwind was considered seriously and rejected on the specifics of this app, not on taste.
  It would add a build step to a product whose whole deployment story is `docker compose up`
  ([0027](#adr-0027)), and its main benefit — consistency without naming things — is worth most
  where many people touch many components. Here the entire UI is ~1,200 lines of server-rendered
  templates, the stylesheet is 12 KB, and design tokens already existed. In `hono/html` template
  literals, utility classes also mean long strings inline where a semantic class reads better.
  What was missing was a scale and a component layer, and neither of those needs a framework.

  The stylesheet URL carries the release version (`/styles.css?v=<version>`), which is the
  cheap, dependency-free way to make a deploy invalidate the cache.

  Two tests hold the line: every class that any rendered page emits must have a rule behind it,
  and the stylesheet's braces must balance — a stray one silently voids the rest of the file.
- **Alternatives:** Tailwind with a CLI build in the Docker image (real option; revisit if the
  UI grows past what one stylesheet can hold, or if contributors start arriving); the Tailwind
  play CDN (compiles in the browser, explicitly not for production); a CSS-in-JS layer (needs a
  bundler and buys nothing server-side).
- **Consequences:** contributors write CSS rather than utility classes, so the tokens section
  is the contract — a hardcoded value is a future inconsistency. Dark mode is still absent and
  is now a matter of redefining tokens under a media query rather than a rewrite.
- **Revisit when:** more than a couple of people work on the UI regularly, the stylesheet stops
  fitting in one file, or a component library becomes worth its build step.

<a id="adr-0054"></a>

## ADR-0054 · The context pack carries every kind of knowledge that describes the project's state

- **Status:** accepted (2026-09-16).
- **Context:** a review of a real project — 349 entries captured from 13 agent sessions — found
  that the context pack rendered **five** of the fourteen entry types in use, because those five
  were hand-written fields on an interface. The other nine were classified, stored, counted and
  searchable, and **never reached an agent at session start**.

  Measured there: **172 of 348 current entries, 51 %**, belonged to types the pack could not
  render. Among them 38 incidents — while the same project's health report was flagging
  "incidents with no decision". The entries were not lost; `search` and `ask` reach them. But
  the promise is that an agent *starts out knowing*, and half the memory was outside that.

  A second finding compounded it. The distiller writes content as "Title. Body…", and the
  summary is its first 240 characters, so **355 of 355 summaries began by repeating the title**.
  The pack prints title and summary one under the other: with titles averaging 47 characters
  against summaries of 206, **23 % of every entry was spent saying the same thing twice**.
- **Decision:** the pack carries every type that describes the **state** of the project —
  decisions, constraints, risks, technical debt, conventions, architecture, business rules,
  incidents, integration notes, module notes, how-tos — declared in one list, `PACK_SECTIONS`,
  which is the single place that answers "what does an agent get told".

  Three types stay out, deliberately: meeting, PR and ticket summaries. They record **an event**,
  not a state. Someone opening a session needs to know how the project stands, not what was said
  in a meeting in March; that is a question you ask when you have it. A test asserts the excluded
  set, so leaving a type out stays a decision rather than becoming an oversight again.

  Sections are **weighted**, because breadth alone would give a how-to the same room as a
  decision in force. What governs today's work weighs double; what accompanies it weighs one; an
  explicitly requested area weighs three.

  The repeated title is stripped when an entry is saved, so every consumer benefits and nothing
  has to be re-rendered.

  The hook's default budget goes from 6,000 to **8,000 characters**. It was sized for a pack
  covering a third of the memory; at 6,000 the wider pack left four sections announced but empty.
  On the real project 8,000 is the point where all eleven carry content — 25 entries instead of
  13, for 33 % more budget, about 2,000 tokens at session start.
- **Alternatives:** keep five sections and let the rest be searchable — that is the status quo,
  and it relies on an agent asking about something it does not know exists; one section per type
  with no weights — a how-to displacing a constraint; summarising the whole memory with an LLM
  per session — latency and cost on every session, over content that is already summaries.
- **Consequences:** a session-start injection is roughly a third larger and much broader. Any new
  entry type must be added to `PACK_SECTIONS` or explicitly excluded — the test forces the choice.
  Entries saved before this keep their duplicated summaries until they are next updated.
- **Revisit when:** the weights prove wrong on a project with a different shape, the excluded
  event types turn out to be wanted, or ranking within a section can use the session's topic
  rather than confidence.

<a id="adr-0055"></a>

## ADR-0055 · An entity is a thing you name, not a claim about the project

- **Status:** accepted (2026-09-16).
- **Context:** `entities.type` accepted `decision` and `incident` — which are **entry** types.
  The extractor duly created entities of those types, using the whole sentence as the name, so
  the same decision was stored twice: once as an entry, with its content, source, author and
  temporal validity, and once as a graph node whose name was that decision's entire sentence.

  On a real installation: **222 such nodes**. The cost was not storage, it was the noise in the
  two screens people actually look at. Those nodes turned up as orphan entities, and
  contradictions were detected **between them** — all 18 `contradicts` relations were
  entity-to-entity and **none** were entry-to-entry, producing pairs as useless as
  `option C ⟷ option A`. Four of the six contradictions on one project had no entry behind
  them at all.

  The extractor was also emitting fragments as entities: `option C`, `package`, `v3`, and whole
  sentences. A health report that is half noise teaches people to stop reading the health
  report — which then costs the real findings too.
- **Decision:** an entity is a **thing that gets named** — a module, a service, a technology, a
  client, a vendor. `decision` and `incident` leave `entityType`, so nothing can create them
  again, and a database constraint refuses them even by hand.

  Names are filtered by shape (`isUsableEntityName`): three to sixty characters, at most six
  words, no trailing full stop, and no bare deictics — `option C` names nothing on its own. The
  bar is deliberately on the side of dropping a real entity rather than admitting a fragment,
  because a missing node costs a link and a junk node costs the report's credibility.

  A migration removes the existing shadow nodes, their links and their relations. **No entry is
  touched**: the knowledge lives there and stays, with its history. What goes is the degraded
  copy.
- **Alternatives:** keep the types and filter them out of lint and the graph — leaves dead rows
  forever and every new consumer has to remember the exclusion; keep them and rely on better
  prompting — the shape of the data was inviting the mistake, not the wording; delete the junk
  names only and keep the types — the sentence-named nodes would come straight back.
- **Consequences:** contradiction detection now works where it belongs, between entries and
  between real entities; it will report **fewer** findings, and that is the point. Projects lose
  some entry↔entity links that carried a weak signal. Any future entity type must pass the same
  test: is it a thing you can name, or a claim about the project?
- **Revisit when:** legitimate entities are being rejected by the name filter, or contradiction
  detection between entries needs to be built out now that the entity noise is gone.

<a id="adr-0056"></a>

## ADR-0056 · A project can be re-parented after it is created

- **Status:** accepted (2026-09-16).
- **Context:** [0051](#adr-0051) made visibility and ownership changeable and left the parent
  out — it was listed as a known gap and it bit within a day. A client with several
  repositories that are not a monorepo is modelled as a parent project with one child per
  repository ([0037](#adr-0037)), and the parent is only set at creation, by whoever runs
  `cortex link --create … --parent <slug>`.

  So the first person on the team to link a repository in a hurry creates a top-level project,
  and there is no way back: not by re-parenting, which did not exist, and not by recreating it,
  because the slug is taken and `createProject` returns the existing project rather than
  inventing a second one. The client's memory stays split, permanently, because of one missing
  flag.
- **Decision:** `updateProject` takes `parentSlug`, so a manager can attach a project to a
  parent, move it, or detach it (`null`). Exposed on `PATCH /projects/:slug` and in the web
  under Settings, next to visibility and owner — where someone looking for it will look.

  Cycles are refused. Permissions and the context pack both walk the ancestor chain, so a cycle
  would not be a wrong answer, it would be an infinite loop; the chain is checked before the
  write, not after.
- **Alternatives:** allow deleting a project so it can be recreated with the right parent —
  much more dangerous for the same outcome, and it would take its entries with it; only allow
  it at creation and document the constraint — which is what we had, and it cost a client's
  memory its structure on day one.
- **Consequences:** moving a project changes who can see it, immediately, in both directions:
  attaching to a private parent closes it, detaching from one opens it. That is the same rule
  as everywhere else, applied live, and the Settings screen says so.
- **Revisit when:** someone needs to move a subtree rather than a single project, or per-project
  roles arrive and moving a project has to reconcile two member lists.

<a id="adr-0057"></a>

## ADR-0057 · An empty project can be deleted; one with memory in it cannot

- **Status:** accepted (2026-09-16).
- **Context:** there was no way to delete a project anywhere — not in the API, the CLI,
  `cortex-admin` or the web. `docs/design.md` even listed it under what deliberately does not
  belong in the UI.

  That reads as caution, and for a project holding knowledge it is. But it also meant a typo was
  permanent. `cortex link --create "Nombre Equivicado"` produced a project that could not be
  renamed, could not be recreated under the right name — the slug was taken — and could not be
  removed. On a shared server that accumulates ghost projects in everyone's list, and only
  someone with database access can clean them.
- **Decision:** a project with **no entries and no children** can be deleted by its owner or an
  admin. Anything else is refused with `409` and stays exactly as it was.

  The line is drawn at *memory*, not at permissions. Deleting an empty project undoes creating
  it and destroys nothing; deleting one with entries destroys knowledge, and in a product whose
  first principle is that invalidating is not deleting ([0012](#adr-0012)), that cannot sit
  behind a button. For that there is a database, a backup, and a decision taken slowly.

  It is the **owner**, not only an admin: the person who mistypes a name should be able to fix
  it without messaging anybody, and there is nothing there to destroy. Making it admin-only
  would add friction exactly where the risk is zero.
- **Alternatives:** admin-only for every deletion — a bottleneck on the harmless case and no
  safer on the dangerous one, which stays closed either way; allow deleting anything with a
  confirmation — confirmations are clicked through, and this one would take a client's memory
  with it; a soft delete — the project list is the problem and a hidden project still holds its
  slug, which is what blocks recreating it.
- **Consequences:** a project's entries have to be moved or invalidated before it can go, which
  is the intended order. The slug is freed on deletion, so the name becomes available again.
- **Revisit when:** somebody legitimately needs to retire a project that holds memory — the
  answer is probably archiving rather than deleting, which is a different feature.

<a id="adr-0058"></a>

## ADR-0058 · Ingesting documentation is part of the CLI; heavy extraction stays on the server

- **Status:** accepted (2026-09-16).
- **Context:** `connect-docs` lived only in `cortex-admin`, which ships inside the Docker image
  and is not published to npm. So ingesting a folder of documentation — one of the first things
  anybody wants to do after seeing what Cortex is for — required cloning the monorepo and
  getting its workspace to install. Someone on the team hit exactly that this week and stopped,
  reasonably, at "I can't connect documentation".

  It was in `cortex-admin` for a real reason: extraction pulls mammoth, xlsx and unpdf, roughly
  95 MB of dependencies, plus a vision model for images and transcription for audio. Keeping
  that off every laptop is the whole point of the thin client ([0025](#adr-0025)).

  But that reason only covers **some** formats. `connect-docs` writes through the authenticated
  API, not the database, and Markdown and plain text need nothing but `readFileSync` — and they
  are most of any team's documentation, and everything a Notion export produces.
- **Decision:** `cortex connect-docs "<slug>" <folder>` ships in the CLI and handles the
  formats that need no dependencies. Chunking, the ignore list and the extension classification
  move to `@cortex/shared` so both connectors agree by construction rather than by memory.

  Files it cannot read are **counted and reported**, grouped by extension, with the command that
  does handle them. A connector that silently skips what it did not upload is worse than one
  that does not upload it: the first leaves you believing the memory is complete.

  The operator connector in `cortex-admin` stays exactly as it is, and remains the answer for
  documents, spreadsheets, images and audio.
- **Alternatives:** publish `cortex-admin` to npm — puts 95 MB and an unused database client on
  every laptop, which is the thing [0025](#adr-0025) exists to prevent; extract on the server by
  uploading the file — architecturally the better end state, since the server already has the
  dependencies and the keys, but it needs an upload endpoint, size limits and a transfer of
  every byte, and it was not going to ship today; bundle only the light extractors into the CLI
  — `unpdf` alone is most of the weight, so the saving is small and the rule stops being simple.
- **Consequences:** two connectors with the same name and different reach, which the CLI's own
  output has to keep explaining — it does. `chunkDocument` moving to `shared` means chunking is
  now client-side for this path; it is deterministic and has no dependencies, so the result is
  identical either way.
- **Revisit when:** extraction moves server-side, at which point the CLI connector handles
  everything and this split disappears — that is the direction, not a permanent shape.

<a id="adr-0059"></a>

## ADR-0059 · `.cortex.json` belongs to the clone, not to a public repository

- **Status:** accepted (2026-09-16).
- **Context:** `.cortex.json` links a folder to a project by slug ([0036](#adr-0036)), and
  committing it is usually right: everyone on a team clones the repository and their agents are
  linked with no further setup. That is what this repository did, with `{"slug": "cortex"}`.

  It stopped being right when this repository became public. A committed link makes **our**
  project identity the default for every clone in the world, and it makes a contributor's first
  act be editing a tracked file — with the working tree dirty, and their own slug one `git add
  -A` away from a pull request.

  Nothing leaks: the file holds a slug and no server, and an unknown slug resolves to nothing
  ([0036](#adr-0036) — linking is not creating). The cost is not exposure, it is that we put our
  own configuration in everybody else's way.
- **Decision:** this repository ignores `.cortex.json`. `cortex link` recreates it in one
  command, which is the same command a contributor would run anyway.

  The general rule, which is what someone adopting Cortex actually needs to know: **commit it in
  a private repository that belongs to one organisation; ignore it in a public one.** The
  question the file answers — "which project is this folder?" — has one answer for a team and a
  different answer for each stranger who clones it.
- **Alternatives:** keep it committed because it shows Cortex using Cortex — the slug alone
  demonstrates nothing, and the memory behind it is on a server nobody outside can reach;
  commit it with an explicit `server` field — worse, that really would point other people's
  agents at our deployment.
- **Consequences:** anyone cloning this repository runs `cortex link` to use it with Cortex,
  which they would have to do anyway to point it at their own server. [0033](#adr-0033) still
  holds — the server is a property of the repository — but a public repository does not belong
  to one organisation, so its link belongs to each clone.
- **Revisit when:** Cortex can link a folder without a file in it, or a public repository needs
  to ship a default project for a demo.

---

<a id="adr-0060"></a>

## ADR-0060 · A project is created, never extracted

- **Status:** accepted (2026-09-16). Sibling of [0055](#adr-0055).
- **Context:** `project` is a legitimate entity type — it is the row that represents the
  project, the one entries hang from and the one `cortex link` and the web list. The classifier
  that runs on every save offered the full `entityType` enum to the LLM, `project` included, so
  any proper noun the model read as a project became an `entities` row with `type='project'`:
  ticket codes, git branches, file names, microservices. The graph extractor already excluded
  `project` for exactly this reason, but only for itself.

  Those rows were indistinguishable from real projects to everything that lists "all entities
  of type project". On a real installation: **26 phantom projects next to 10 real ones**, every
  phantom with zero entries and no slug or owner, all born from one ingestion session into a
  single existing project. `isUsableEntityName` ([0055](#adr-0055)) does not help: it judges
  the shape of a name, not the type.
- **Decision:** a project is **created**, by `createProject`, with a slug and an owner. It is
  never a side effect of extraction.
  1. What the extractors are offered is `extractableEntityType` — the enum minus `project` —
     and the rule lives in `shared`, so every extractor gets it rather than each one remembering
     to filter.
  2. `core` drops any detected entity of type `project` before resolving it, whatever produced
     it, and `resolveEntity` refuses the type outright: the only way to a project row is
     `createProject`.
  3. The database states the invariant: a `project` has a slug, or it is not a project
     (`CHECK`). This is what tells a real project from a mention, and it is what
     [0051](#adr-0051) had already made true for every project created on purpose.
  4. A migration removes the phantoms — only those with no entries, children or members
     hanging from them — with their links and relations. **No entry is touched.** Anything that
     did have something hanging from it would be given a slug instead, as
     [0051](#adr-0051)'s backfill did.
- **Alternatives:** filter `project` out of the listing only — leaves the rows and the
  `belongs_to` noise, and the next listing forgets; remove `project` from `entityType` as
  [0055](#adr-0055) did with `decision` — impossible, the project *is* an entity of that type;
  keep a separate `projects` table — the right long-term shape, but a large migration for a
  problem that a filter plus a constraint closes.
- **Consequences:** `createProject` inserts the row with its slug in one statement, since the
  constraint forbids "insert the name, fill in the slug later". The seed uses it too.
- **Revisit when:** projects move to their own table, or a legitimate reason appears to link an
  entry to a project it merely mentions.

---

<a id="adr-0061"></a>

## ADR-0061 · What you type in `project` resolves by slug first, then by name, everywhere

- **Status:** accepted (2026-09-16). Extends [0043](#adr-0043).
- **Context:** the slug is the project's identity across the product: it is what `cortex link`
  prints, what `.cortex.json` stores, what the web puts in `/p/<slug>/…` and what the HTTP API
  takes ([0036](#adr-0036), [0051](#adr-0051)). The MCP tools, however, take a free-text
  `project`, and that went through two different resolutions. Writes went through
  `createProject`, which looks the slug up first, so `save_project_context` with `acme-portal`
  landed in Acme Portal. Reads went through the canonical-name lookup of [0043](#adr-0043),
  and canonicalisation does not touch hyphens, so `get_project_context_pack` with the same
  value answered "Project not found". A third path, the MCP permission guard, compared the
  **exact** name, and so rejected spellings that the data operations accepted.

  Verified against a real server: the pack for `cortex` failed and the pack for `Cortex`
  worked. The asymmetry is the worst part: the identifier the user has in front of them works
  in one direction and fails silently in the other, with nothing explaining why.
- **Decision:** one function resolves whatever someone types in `project`: **by slug first,
  then by canonical name**. `findProjectIdByName`, `findProjectByName` and therefore
  `checkProjectAccess` all go through it; `findProjectBySlug` stays as the strict form for
  routes and the API, where the slug is already the identifier. The context pack reports the
  project's **name**, not the string it was asked with. Tool descriptions say "slug or name".

  If a project's *name* happens to equal another project's *slug*, the slug wins: it is the
  identifier, the name is a label. Such collisions only exist because of the bug this fixes
  (a project literally named after another's slug, created by a write that missed).
- **Alternatives:** detect slug-shaped input and return "that is a slug, use the name" — cheaper,
  and leaves the product contradicting itself; make canonicalisation treat hyphens as spaces —
  would make `acme-portal` and `Acme Portal` collide in the *entity* dedup too, which is a
  different question; require the slug everywhere — right in principle, but agents pass names
  and every existing transcript does.
- **Consequences:** the [0043](#adr-0043) "revisit when" condition is met and this record is its
  continuation. The exact-name guard is gone, so a private project is now protected under any
  spelling of its name, which it was not before.
- **Revisit when:** the MCP tools take a `slug` field of their own, or projects get their own
  table with the slug as key.
