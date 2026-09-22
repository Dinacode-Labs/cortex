# How Cortex works

[← Back to the README](../README.md)

This guide explains the machinery from the ground up: what an embedding is, what RAG means,
what a knowledge graph buys you, what each AI agent actually does. No prior experience with
retrieval systems is assumed.

The goal is not to sell you on the design. It is to give you enough understanding to **judge
whether Cortex works well and where it should be improved**. That is why every section ends
with a **⚠️ What to watch for** box listing the real limits of the technique, including the
places where the current implementation is a deliberate shortcut.

Some examples keep their original Spanish text. Cortex was built against a Spanish corpus,
and the examples are real shapes of data rather than invented ones.

## 0. The problem and the idea, in one picture

**The problem.** In a consultancy, project knowledge lives scattered: in the head of whoever
built it, in a ticket, in a chat thread, in a pull request, in a PDF from the client. When
someone new joins, or when an **AI agent** opens a session, they start blind. They do not know
that *this* client forbids public cloud, or that *that* module has already broken twice on
timeouts. So they repeat mistakes and ask the same questions again.

**The idea.** Cortex is a **project memory** that:

```
   CAPTURES           STRUCTURES                RETRIEVES             SERVES
 (from many       (classifies, links into    (hybrid search      (people, through the UI;
  sources:         a graph, dates each        + graph + time      AI agents, through MCP
  chat, PRs,       fact and marks how          filter)            and hooks)
  docs, code,      long it held)
  AI sessions)
```

The **loop** that makes it automatic: when you open a session with your agent, a hook
**injects** what Cortex knows about the project. When you close it, another hook sends the
conversation, condensed and stripped of secrets, to the server, which **distils** what was
learned and **stores** it. You work, Cortex learns, the next person starts knowing more.

Distillation happens on the **server**, not on your machine. It is the part that needs a
language model, and doing it server-side means no laptop needs AI credentials. Your team just
installs the CLI and signs in.

**One design decision worth understanding up front:** Cortex is split in two.

- **`@cortex/core` is deterministic.** It saves, searches, deduplicates and links **without
  calling any LLM**. It works with no API keys at all.
- **`@cortex/agents` is the intelligence.** It wraps LLM calls (classify, extract the graph,
  rerank, synthesise answers) and is **injected** into core at startup through
  `setClassifier`, `setReranker` and `setReconciler`. With no LLM configured, core **falls
  back to heuristics** and keeps working.
- **The precedence never changes:** *explicit input > LLM > heuristic*. The AI **augments**.
  It is never a single point of failure.

## 1. The unit of knowledge (and provenance)

Everything Cortex knows is a **context entry** (`context_entries`). Each entry is **one
fact**: a decision, a constraint, an incident, a convention. There are **14 types**:
`decision`, `constraint`, `incident`, `architecture`, `module_note`, `technical_debt`,
`convention`, `business_rule`, `integration_note`, `risk`, `how_to`, `meeting_summary`,
`pr_summary`, `ticket_resolution`.

What separates Cortex from a drawer full of notes is that **every fact carries its
provenance**. An example entry:

```
title:            "Acme Corp does not allow public cloud services"
content:          "The solution has to be deployed on their own infrastructure (on-prem)."
type:             constraint
─── provenance ───────────────────────────────────────────────────────
source_type:      meeting_transcript          ← where it came from
source_reference: "Kickoff meeting 2026-01"   ← pointer to the original
created_by:       "ana@example.com"           ← WHO recorded it (attribution)
created_at:       2026-01-10                  ← WHEN we learned it
confidence:       verified                    ← how much we trust it
status:           validated                   ← where it sits in its lifecycle
validity:         current                     ← is it still true?
valid_from/_to:   2026-01-10 / NULL           ← time window (see §6)
```

- **`confidence`** (`low` < `medium` < `high` < `verified`): a note auto-captured from a
  session enters as `low`. Something confirmed against a real source can be `verified`. The
  lint reports how many low-confidence entries a project carries.
- **`status`** is the lifecycle: `draft → pending_validation → validated / rejected /
  obsolete / superseded`. The context pack and the decision list **exclude** anything
  `rejected` or `obsolete`.
- **`validity`** plus **`valid_from`/`valid_to`** is the time dimension, covered in §6.

> **💡 Why this matters.** Never turn an inference into a fact. If an image caption or an LLM
> summary gets stored, it is stored **as an inference**, with its confidence and its origin
> attached, not as ground truth. That way a human can validate, reject or correct it later,
> and you can always trace where something came from.

> **⚠️ What to watch for.** The default `status` is `pending_validation`, and today **nobody
> validates systematically by hand**. That would be too much friction. Quality rises through
> auto-curation instead (§8), not through human review. If a given client needs stronger
> guarantees, that review workflow does not exist yet. It is on the roadmap.

## 2. Embeddings and vector search, the basis of RAG

**RAG** stands for *Retrieval-Augmented Generation*. In plain terms: instead of asking the
LLM to answer from memory, you first **retrieve** the relevant pieces of knowledge and hand
them over as context. The interesting question is how you find "the relevant pieces".

**Embeddings, the key piece.** An embedding turns a text into a **list of numbers**, a
vector, arranged so that **texts with similar meaning land close together** in that space.
Picture a map where "checkout is down" and "payment error" sit almost on top of each other
even though they **share no words at all**. That is what a *semantic* embedding captures.

**Vector search.** To search, you embed **the question** too and measure which entries have
the nearest vector. Cortex uses Postgres with the **pgvector** extension and measures
closeness with **cosine distance** (the `<=>` operator). Lower distance means more similar.
Results come back ordered from nearest to furthest.

**Embedding providers are pluggable** through `EMBEDDINGS_PROVIDER`:

| Provider | Model | Dimensions | Semantic? |
| --- | --- | --- | --- |
| `local` (default) | feature hashing | 256 | **No.** Word overlap only |
| `openai-compatible` | whatever the endpoint serves | whatever you declare in `EMBEDDINGS_DIM` | Yes |
| `openai` | `text-embedding-3-large` | 3072 | Yes |
| `voyage` | `voyage-3` | 1024 | Yes |

> **⚠️ What to watch for. This section matters most, because it is where people form a false
> impression of the system:**
> - **`local` is not semantic.** It is not a neural network. It hashes each word into one of
>   256 buckets, the classic *hashing trick*. Two texts look similar **only if they share
>   literal words**. "car" and "automobile" land in different buckets. It exists **so the
>   system boots with no keys** and you can test the wiring. **To judge real search quality,
>   configure `openai-compatible`, `openai` or `voyage`.** With `local` the system *looks*
>   dumb, and that is not the design's fault.
> - **There is no ANN index** (no HNSW, no IVFFlat). Vector search is an **exact scan** over
>   the filtered rows. Correct and simple, but **O(n)**, so it will not scale to hundreds of
>   thousands of entries. This is a conscious demo-stage choice.
> - **Switching provider forces a reindex.** Every vector stores its `embedding_model` and
>   its dimensions, and search only compares against vectors **from the active model**. If
>   you move from `local` (256 dimensions) to `openai` (3072) without re-embedding, the
>   vector branch matches **zero rows, silently**, and search quietly degrades to
>   lexical-only.
> - **A regular entry is not split.** One entry, one vector. A very long entry gets embedded
>   whole. Documents ingested through the docs connector **are** chunked structurally before
>   they become entries, and indexed code is chunked too, but `saveContext` itself does not
>   chunk.

## 3. Lexical search and hybrid search (RRF)

Vector search is excellent at **meaning** and weak at **literals**. If you search for
`TICKET-4821` or `OAuth2 PKCE`, you want that **exact** token, and the vector may not nail
it. That is what **lexical search** is for. Postgres keeps a full-text index of the words in
each entry, with Spanish stemming, so "facturación", "facturar" and "factura" share a root,
and it matches on terms.

- **Vector** captures *sense*: paraphrases, synonyms.
- **Lexical** captures *precision*: IDs, proper nouns, jargon, acronyms.

Cortex runs **hybrid search**: it fires **both** and **fuses** the rankings. Fusing is
awkward because the scores are not comparable. Cosine distance runs 0 to 1, the lexical score
is a different scale entirely. The answer is **Reciprocal Rank Fusion (RRF)**, which ignores
the scores and uses only each result's **position** in each list:

```
RRF_score(doc) = Σ   1 / (K + rank)          with K = 60
              (summed over each list, vector and lexical, where the doc appears)
```

**The intuition:** being **1st** in a list is worth slightly more than being 2nd, and a lot
more than being 10th, with diminishing returns. `K = 60` smooths the curve. The important
part: if a document shows up **in both lists**, its contributions **add up** and it rises to
the top. In other words, RRF **rewards whatever is both semantically relevant and a word
match**, which is exactly what you want.

**An example.** Question: *"how do we deploy the billing module?"*

```
VECTOR branch (by meaning)          LEXICAL branch (by words)
 1. A  How-to: deploy billing        1. B  Constraint: billing must be on-prem
 2. C  Decision: we picked Stripe    2. A  How-to: deploy billing
 3. B  Constraint: on-prem
 4. D  Incident: checkout

RRF fuses →  A and B appear in BOTH lists  →  they rise to the top
Result:  A , B , C , D     (A and B separate clearly from C and D)
```

> **⚠️ What to watch for.**
> - The **number shown** as each result's "score" **is not the RRF value**. RRF decides the
>   *order*, but the visible score is **cosine similarity** for hits that came through the
>   vector branch, or the normalised RRF for lexical-only hits. Do not re-sort the results in
>   your head by that number.
> - The lexical branch uses Postgres `ts_rank`, which is BM25-like but not BM25. For real
>   BM25 you would look at `pg_search` or ParadeDB. That is noted in the decision log.

## 4. Rerank: a second opinion from the LLM

Hybrid search plus RRF gives you a decent pile of candidates, ordered by a mechanical
formula. **Rerank** is an optional extra step: take the top candidates and ask an **LLM** to
reorder them from most to least relevant **for this specific question**, discarding the
noise. It is the difference between "matches" and "actually answers".

- It only runs when an LLM is configured and `CORTEX_RERANK` is not set to `off`. It is
  injected with `setReranker`. Core on its own never calls an LLM.
- It is **fail-safe**. If the LLM is down, there is at most one candidate, or the response
  does not parse, you get the hybrid order back **and nothing breaks**. It never "loses"
  results either: anything the LLM does not mention is appended at the end.

> **⚠️ What to watch for.** A **dedicated reranker model** we tested gave **unreliable**
> results. At one point it ranked an omelette recipe above payment documentation. So the
> **chat LLM** does the reranking instead. It works, but it is **slower and more expensive**
> than a good dedicated reranker such as Cohere or Voyage. This is a clear candidate for
> re-evaluation.

## 5. The knowledge graph (entities and relations)

Search gives you loose pieces of text. A **knowledge graph** gives you **how things relate**.
The idea, simply:

- **Nodes (entities):** the "things" in the project. A client, a module, a technology, a
  service, a person, an integration. There are **9 entity types**. One of them, `project`, is
  the row that represents the project itself: it is created on purpose (`cortex link --create`
  or the first save into it), never extracted from text.
- **Edges (relations):** **typed** connections between nodes. "the billing module
  *depends_on* the ERP integration", "incident X was *caused_by* Stripe". There are **10
  relation types**: `depends_on`, `affects`, `caused_by`, `resolved_by`, `supersedes`,
  `contradicts`, `belongs_to`, `implemented_by`, `discussed_in`, `related_to`.

One neat detail: **the entry itself can be a node**. When the graph extractor finds a
relation whose source is the entry, it uses the keyword `"ENTRY"`. That lets an incident
connect straight to what it affects:

```
[entry: "The billing PDF times out under heavy load"]
        │ affects
        ▼
[module: billing] ──belongs_to──▶ [project: Acme Portal] ──belongs_to──▶ [client: Acme Corp]
```

**Variant resolution (dedup).** "Acme", "Acme Corp" and "acme.com" are the same client.
Cortex normalises names (lowercase, accents stripped) and keeps **one canonical node per
(type, normalised name)**. A maintenance step, `resolveEntities`, also merges variants that
do not normalise to the same string, repointing their links and relations to the winning
node, which is the most connected one. Deterministic, no LLM involved.

**Questions the graph answers** that text search cannot:

- "What does the billing module touch? What breaks if I change it?" You walk the edges.
- "Which are the sensitive modules in this project?" The `module` entities of the project.
- "Where are the contradictions?" The `contradicts` edges.
- "Which areas keep breaking but have no documented decision?" That is the gap check in §10.

> **⚠️ What to watch for.**
> - The "graph" is **two Postgres tables** (`entities` and `relations`), not a graph database
>   like Neo4j. It is fine for one-hop expansion. **Deep multi-hop traversals** would be
>   awkward in SQL.
> - Relation extraction is done by an **LLM** (the `graph` agent), so it can invent or miss
>   edges. There is an integrity filter, a relation only survives if both of its endpoints
>   are known entities, but **there is no graph extraction without an LLM**. Without one you
>   get dictionary-matched entities and no rich relations.
> - **Contradictions between entities do not resolve themselves.** There is no obvious
>   winner, so the lint reports them for a human to decide.

## 6. Bi-temporal: time, and why invalidating is not deleting

Facts **change**. In January we decided to "keep the legacy billing module". In June we
decided to "migrate it". A naive system **overwrites** the old fact, and then you can no
longer answer "what did we believe in March?". Cortex is **bi-temporal**: it never deletes,
it records *when each thing was true*.

Every fact carries **two axes of time**:

- **`valid_from` / `valid_to`** is the **validity window**: from when until when it held in
  the real world. **`valid_to = NULL` means "true right now".**
- **`observed_at`** is when the **source asserted it**: the date of the meeting, of the
  ticket.
- **`created_at`** is when **Cortex ingested it**: the system axis.

**The principle: invalidating is not deleting.** Retiring a fact does not delete the row, it
**closes its window** by setting `valid_to`. The row is still there and still queryable. A
new decision that replaces an old one creates a `supersedes` edge and closes the old window.

**Point-in-time queries (`asOf`).** Because history is preserved, you can ask "what did we
know as of date X?":

```
2026-01-10  Decision A: "keep the legacy module"     → valid_from=01-10, valid_to=NULL
2026-06-01  Decision B: "migrate the legacy module"  → B supersedes A
            (on invalidation)  A: valid_to=06-01, superseded_by=B, validity=superseded

  Query asOf = 2026-03-15  → returns A ("keep")      ← what we believed back then
  Query asOf = 2026-06-10 (or no asOf) → returns B ("migrate")  ← what holds now
```

By default, search and the context pack return **only what currently holds** (`valid_to IS
NULL`). `asOf` reconstructs any past snapshot. Measured on a real pilot project: 266 current
facts against 147 historical ones, where the same project had 182 on 2026-05-28 and 239 on
2026-06-12.

> **⚠️ What to watch for.** Auto-invalidation covers **entry-to-entry supersession** and
> facts explicitly marked as historical. **Contradictions between graph entities are not
> auto-invalidated**, the lint reports them. And there is no adaptive decay based on how
> volatile a topic is yet. Ageing follows fixed rules.

## 7. The AI agents, one by one

"Agent" here does **not** mean an autonomous robot reasoning in a loop and calling tools. It
means **a role backed by a single LLM call**: a system prompt, a prompt, result parsing, and
a fallback if it fails. There are seven, plus a couple of orchestrators. They all go through
one shared function, `runAgent`, which also **records the tokens** spent, for observability.

| Agent | What it does | With no LLM |
| --- | --- | --- |
| `classifier` | Classifies a text and extracts entities | core heuristics |
| `graph` | Extracts entities **and relations**, the graph | nothing (dictionary entities only) |
| `reranker` | Reorders search results | original hybrid order |
| `retriever` | Writes the prose answer, citing the context | shows the raw fragments |
| `distiller` | Distils a session or meeting into typed knowledge, each item with its own summary | nothing |
| `reconciler` | Decides noop / update / supersede on a near-duplicate | deterministic dedup (noop only) |
| `merger` | Merges two pieces about the same thing into one | keeps the existing one |

**Concrete examples of each transformation.** The inputs are in Spanish because that is the
corpus these prompts were tuned against.

**`classifier`**, loose text into a typed entry:

```
IN : "Decidimos introducir RabbitMQ para procesar las exportaciones de
      facturación de forma asíncrona y evitar timeouts."
OUT: { type: "decision",
       title: "Cola RabbitMQ para exportaciones de facturación asíncronas",
       summary: "Se introduce RabbitMQ para exportar facturación async y evitar timeouts.",
       entities: [ { name: "RabbitMQ", type: "technology" } ] }
```

**`graph`**, text into entities plus relations:

```
IN : "La pasarela Stripe devolvió 500 en producción; lo causó un cambio de
      versión de la API de Stripe. Se resolvió fijando la versión."
OUT: { entities:  [ { name: "Stripe", type: "integration" } ],
       relations: [ { source: "ENTRY", target: "Stripe", type: "caused_by" } ] }
```

**`reconciler` plus `merger`**, new information that refines the old:

```
EXISTING: "Se usa RabbitMQ para exportaciones asíncronas."
NEW     : "Las exportaciones de facturación ahora van por RabbitMQ con reintentos y DLQ."
reconciler → "update"   (refines, does not contradict)
merger     → "Cola de exportaciones con RabbitMQ
              Las exportaciones de facturación se procesan async con RabbitMQ,
              con reintentos y dead-letter queue."   → replaces and re-embeds the old one
```

**`retriever`**, question plus fragments into prose. This is the classic "generation" step of
RAG: it writes **only** from the retrieved context, and says so when the context is not
enough.

> **⚠️ What to watch for.**
> - **Default models:** `deepseek-v4-flash` on an OpenAI-compatible endpoint, or
>   `deepseek/deepseek-v4-pro` through OpenRouter. Classification, graph extraction and
>   reconciliation quality **depend on the model**, so evaluate with the one you intend to
>   run in production. `CORTEX_MODEL_<ROLE>` overrides the model per role.
> - **Structured output is enforced by hand.** Models do not reliably honour Mastra's
>   `structuredOutput`, so Cortex forces `response_format: json_object` and **validates the
>   JSON manually**, discarding invalid keys and edges. It works and it is fast, but it is a
>   workaround.
> - **Each agent is ONE call**, not a reasoning loop with tools. Simple and cheap, but it
>   does not "think it over" or self-correct.
> - **A technical footnote:** `@cortex/agents` uses **zod v4**, which Mastra requires,
>   isolated from the **zod v3** used by the rest of the repo. Schemas never cross between
>   the two sides. The boundary is crossed with plain TypeScript types.

## 8. The capture and reconciliation loop (mem0 style)

When new knowledge arrives, either from an explicit save or from closing a session, it is not
dumped in raw. The key step is **reconciliation**, inspired by
[mem0](https://github.com/mem0ai/mem0). For each new piece, Cortex finds the most similar
existing one and decides **what to do**:

```
similarity ≥ 0.95                   → NOOP        (near-identical, whatever its origin)
similarity 0.82–0.95 (reconciler available):
        reconciler says "update"     → MERGE      (fuse and re-embed)  [auto-captured only]
        reconciler says "supersede"  → INVALIDATE (close the old window, see §6)
                                       or, if the old one is sourced or curated → "contradicts"
        reconciler says "noop"       → the old one stands
similarity < 0.82                   → ADD         (enters as a new fact, low confidence)
```

Both thresholds are configurable, through `CORTEX_DEDUP_NOOP` and `CORTEX_DEDUP_THRESHOLD`.

Every outcome that does **not** add a new entry — a no-op or a merge — counts as a
**corroboration** of the entry that was already there, and it is that count, not the fact of
having been written to, that auto-curation promotes on ([ADR-0067](decisions.md#adr-0067)).

**The critical guardrail:** Cortex **never automatically rewrites or invalidates** knowledge
that came from a source or was curated by a human. Only **auto-captured** entries
(`agent_session`) get merged or superseded on their own. If a new note contradicts something
curated, a `contradicts` edge is recorded so **a person reviews it**. The AI does not
overwrite what a human signed off on.

**The two routes are not equally good.** An entry saved **through the tool**, by the agent that was
there when it happened, carries the why and the where and its title reads like a decision. A
distilled one is a session summarised afterwards by a model that was not in the room: the *what*
survives, the reason often does not. So the agent is pushed to save **mid-task**, at the moment
something is decided, confirmed, rejected, corrected or fixed with a known root cause — that is what
the `cortex-capture` skill is, a trigger list with a self-check, a list of what **not** to save and
one format. Distillation stays as the net underneath, for the sessions where nobody saved anything
([ADR-0066](decisions.md#adr-0066)). The read half has the same shape in `cortex-recall`: a
question about the project is asked of the memory before it is answered out of the tree
([ADR-0069](decisions.md#adr-0069)).

**Auto-curation, with no human in the loop.** Capture writes immediately, at low confidence.
Later, `maintain` runs `autoCurate`, which **promotes** to medium confidence anything that
has been **corroborated** — the same knowledge arrived again and reconciliation had nothing
to add to it, or folded it in — and **decays**, so removes from search, old material that
nothing ever corroborated. Corroborations are **counted**, one per encounter. Being written
to does not count as one: an entry gets reclassified, re-embedded and corrected by hand
without any of that making it truer ([ADR-0067](decisions.md#adr-0067)). Quality rises over
time without slowing capture down.

**Secrets.** Before the LLM sees anything, and again before storing, **secrets are
stripped**: PEM keys, JWTs, `sk-…`, GitHub, Slack, AWS and Google tokens, `Bearer …` and
`Basic …` headers, `api_key=…`, passwords inside connection strings, and `Cookie` headers.
Stripping runs in two independent layers: during distillation, whichever agent the session
came from, and again on save at the server, which **does not trust** the client to have
cleaned anything. Work sessions are personal logs. Cortex distils the knowledge, it does not
keep the raw transcript.

> **⚠️ What to watch for.** The thresholds (`0.95`, `0.82`) are **parameters to calibrate**.
> Too high and you get duplicates, too low and it merges things that are genuinely different.
> When in doubt, for instance when the LLM errors, the reconciler leans towards **"update"**,
> on the principle of not invalidating lightly. Evaluate against real data whether
> reconciliation is merging what it should.

## 9. The context pack and inheritance

The **context pack** is "what an agent should always know" about a project, kept small and
curated. `get_project_context_pack` assembles **current decisions, constraints, risks,
technical debt, conventions and sensitive modules**, plus, if you pass an `area`, the top five
most relevant items for that area, found by vector search. Only current facts by default, and
it accepts `asOf` for a historical snapshot.

**Inheritance.** A subproject **inherits the context of its ancestors**. If "Acme" is the
client and `acme-api` a subproject, the pack for `acme-api` includes what is common to "Acme"
**without** mixing in the context of `acme-web`. That avoids the context rot of throwing
everything into one bag, while still not duplicating what is shared. Permissions cascade the
same way: being a member of "Acme" opens its subprojects.

This pack, rendered to Markdown, is **exactly what the `SessionStart` hook injects** into
your agent when you open a session. It goes through the authenticated API within a character
budget — roughly 8000, configurable with `CORTEX_HOOK_CTX_CHARS`.

Above it go **three lines** and no more: what this is, read it before touching a module, and when to
write back (`When the user decides, confirms or corrects you, save it with save_project_context`).
Under 300 characters, because every character of preamble is one the pack does not get — and the
pack is the part the agent cannot work out by reading the code. The same sentence reaches the agents
with no plugin through the MCP's `instructions`, which `cortex mcp` declares itself: `initialize` is
answered by the proxy, before it has talked to any server.

**What each line says.** An entry is rendered as its title and, under it, its `summary` — the
content only when there is no summary. So the summary is not decoration: it is the entry, as far as
the agent is concerned. It comes from whoever knows best, in this order: an explicit summary from
whoever saved the entry, then the one the LLM wrote (the classifier and the distiller both produce
one), then the heuristic. The heuristic takes the Markdown out and keeps whole sentences up to 240
characters, so a document chunk arrives as prose rather than as its own first 240 raw characters,
and it never ends mid-word ([ADR-0068](decisions.md#adr-0068)). Entries stored before that was true
are rebuilt in place by `cortex-admin resummarize`.

**What goes in it.** Everything that describes the **state** of the project: decisions,
constraints, risks, technical debt, conventions, architecture, business rules, past incidents,
integrations, module notes and how-tos. Left out on purpose are the three types that record an
**event** rather than a state — meeting, PR and ticket summaries — which `search` and `ask`
still reach ([ADR-0054](decisions.md#adr-0054)).

**How it shortens matters more than the number.** The budget is shared out between sections
rather than spent from the top, so every kind of knowledge reaches the agent, each section saying
how many entries it left behind and how to read them — **+15 more** not shown
(`type: "constraint"`), which is the argument `search_project_context` takes
([ADR-0069](decisions.md#adr-0069)). The pack's own header carries both numbers,
`Showing 38 of 349 entries`, so it cannot be mistaken for the memory.
Sections that govern today's work — decisions, constraints, architecture — carry twice the
weight of the ones that merely accompany it. Within a section, higher-confidence entries come
first. The point is that a missing section reads as "this project has none of those", which is
a far more expensive thing to be wrong about than seeing fewer decisions
([ADR-0049](decisions.md#adr-0049)).

> **⚠️ What to watch for.** Inheritance applies to the **context pack**, not to `search` or
> `ask`. A search inside the subproject does not yet pull in the parent's knowledge. And on a
> large project the pack is still **a sample**: ranking within a section is by confidence, not
> by what this session is actually about, because the hook does not know that yet. A navigable
> or hierarchical index is **still under study on the roadmap**.

## 10. Lint (knowledge health) and observability

**Lint.** Like a code linter, `lint_project_context` inspects the **health of the knowledge
base**, a step almost no product on the market bothers with. It checks:

1. **Contradictions**, the `contradicts` edges in the graph.
2. **Likely duplicates**, pairs with vector similarity above 0.85 within one type and above
   0.88 across types, **skipping the parts of a single document**: an ingested file becomes N
   overlapping chunks that resemble each other by construction, and reporting them as
   duplicates buried the ones worth acting on.
3. **Orphan entities**, a node linked to a single entry and with no relations.
4. **Never reviewed**, how many current entries no person has ever confirmed or corrected.
   Usually the biggest number in the report: while nobody validates, `status` and `confidence`
   carry no information and the pack cannot favour what is trustworthy.
5. **Low confidence**, how many `low` entries there are.
6. **Historical and obsolete material**, how much has aged out.
7. **Gaps**, the interesting one: modules or services with **two or more incidents and zero
   decisions** documented. Things that keep breaking while nobody has written down what to do
   about it.

There is a planner, `lint-act`, that turns those findings into proposed actions: open a task
for a gap, consolidate duplicates. It is **dry-run only**. It prints the plan and **writes
nothing** to external systems. Actually creating tasks is a separate, supervised step.

**Observability.** Every AI call, LLM and embeddings alike, records its **tokens** in the
`llm_usage` table, with a pricing table to **estimate cost**. Costs are estimates, and the
pricing table can be corrected without a deploy through `CORTEX_PRICING_JSON`. On top of
that, each agent run emits a **trace tree** (`agent_run → model_generation → …`) into the
`ai_traces` table. The `/admin/usage` page in the UI shows cost per operation, agent and model,
alongside the trace tree.

> **⚠️ What to watch for.** The lint is **deterministic and cheap**, but its thresholds and
> rules, what counts as a "duplicate", what counts as a "gap", are heuristics. Treat them as
> a signal, not as truth. And for now it **reports** rather than fixes, by design.

---

## How to evaluate Cortex: a checklist

The point of this whole guide is that you can **judge for yourself** whether Cortex works and
where it should improve. When you try it, look at these things above all:

1. **Which embedding provider are you testing with?** With `local`, search **is not
   semantic**, so do not draw conclusions about quality. Configure `openai-compatible`,
   `openai` or `voyage`.
2. **Does hybrid search surface the relevant thing?** Try queries by **meaning**, which
   should work through the vector branch, and by **ID or jargon**, which should work through
   the lexical branch. If something obvious does not come up, check whether it is indexed,
   and with what confidence and validity.
3. **Does the graph connect things properly?** Look for duplicate entities, which may just
   need a `resolve` pass, and for invented or missing relations, since an LLM puts them
   there.
4. **Does reconciliation merge what it should?** Are you seeing duplicates, which means the
   threshold is too high, or things merged that should not be, which means it is too low?
   Does it respect human-curated material?
5. **Does the time dimension hold up?** Mark something as superseded and check that `asOf`
   returns the right snapshot and that the current view excludes the old one.
6. **Does auto-capture distil well?** Close a session and look at what it stored. Useful
   typed knowledge, or noise? Did any secret slip through? It should not have. To measure it
   rather than judge it by eye, `pnpm admin eval-distill` runs the distiller over a fixed set
   of session windows with an annotated expectation each and reports what it kept, what it
   dropped and what it mistyped.
7. **Cost and latency:** look at `/admin/usage`. How many tokens does it cost to classify, rerank
   and distil? Does the LLM earn its keep against the heuristics for your case?

All of the above is a **hypothesis to be validated**. If you find a weak spot, write it down.
The live decisions are in [`decisions.md`](./decisions.md) and the open work and ideas in
[`roadmap.md`](./roadmap.md). How to contribute: [`CONTRIBUTING.md`](../CONTRIBUTING.md).
