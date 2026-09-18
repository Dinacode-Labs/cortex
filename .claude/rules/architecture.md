# Architecture: the boundaries that do not get crossed

## What may import what

```
shared      → (nothing)                       types, enums, zod v3, the HTTP contract, env, scrub, branding
client      → shared                          HTTP, credentials, .cortex.json, transcripts
database    → shared                          postgres.js + migrations
embeddings  → shared                          pluggable provider
core        → client, database, embeddings, shared    the domain, deterministic, NO LLM
agents      → client, core, database, shared          the LLM layer (Mastra, zod v4 isolated)
apps/*      → any package
```

- A package **never** imports from `apps/*`, nor another package's files by path: only its public
  entry point, `@cortex/<x>`.
- **`apps/cli` may depend only on `client` and `shared`.** If a command needs the database, the
  model, or to stand up a service, it belongs in `apps/admin`.
- **`client` is kept lightweight on purpose**: no Postgres, no Mastra, no embeddings. That is what
  lets the CLI ship through `npm i -g` without dragging ~95 MB onto every developer's laptop
  (ADR-0025).
- The last two are watched by `tests/client-package.test.ts`. Do not add exceptions: if you need
  one, the command is in the wrong place.

## `core` does not know the LLM exists

- `core` is **deterministic**. Anything that needs a model is declared as a hook in `core`
  (`setClassifier`, `setReranker`, `setReconciler`, `setMediaExtractor`, `registerUsageSink`) and
  wired by `agents` in exactly one place: `packages/agents/src/wire.ts`.
- An entrypoint always does, in this order: `loadEnv()` → `wireLlm()` → start.
- **Everything has to keep working without `LLM_PROVIDER`**, on heuristics and at worse quality.
  If your change does not work without a model, it is in the wrong layer. The integration tests
  run with `LLM_PROVIDER=none` precisely so this does not erode.
- zod **v3** across the repo; `agents` uses **v4** because Mastra requires it. Never cross schemas
  between the two.

## Side effects: entrypoints only

- `loadEnv()`, `wireLlm()`, `serve()`, `process.exit()`, opening connections: **only** in an app's
  `index.ts` (or a `*-cli.ts`). Importing a library module must do nothing.
- Shared resource → lazy singleton (`getSql()`, `getEmbeddingProvider()`), never built at import
  time.

## The app is composed; the entrypoint starts it

`createApp()` only composes (middleware + routes + `onError`) and has no side effects; `index.ts`
loads the environment, wires and serves. That is what lets the tests exercise routes with
`app.request()` without opening a port — and why `createApp()` takes its expensive dependencies
injected (`AppDeps.distill`).

## `web` and `server` are two clients of `core`, not two layers

- `apps/web` calls `core` **directly**. Do not add a `fetch("/api/…")` from a web handler
  (ADR-0042): they serve different clients — a browser with a cookie against a CLI with a bearer
  token — and whatever they duplicate is pulled out into a helper, not coupled.
- Read `docs/design.md` **before** touching `apps/web`: it says what the UI is for and what it is
  not.

## The CLI and the server are not in lockstep

The contract is the HTTP API (ADR-0062), and each side updates on its own schedule:

- A new field in a response → **optional** where it is read.
- A new endpoint → a **404 means "old server"**, not an error: degrade (skip the feature, keep the
  previous behaviour, or say so plainly).
- The only thing that blocks is `minClientVersion`, and only for writes.
- The hooks and `cortex mcp` **never** write anything to stdout that is not protocol, not even a
  version notice. There is a test.

## Database

- **No ORM.** postgres.js with tagged templates; never concatenate SQL into a string.
- `snake_case` in the database, `camelCase` in TypeScript. The translation lives in one place:
  `packages/core/src/map.ts` (ADR-0022).
- A schema change is a new migration in `packages/database/migrations/NNNN_desc.sql`,
  **idempotent** (`IF NOT EXISTS`). Never edit a migration that has already been applied, and
  never rename one: the filename is a primary key in `schema_migrations`.
- The access filter goes **in the query**, never after a `limit` (ADR-0052): otherwise the page
  comes back empty because the cut ate what you were allowed to see.

## Secrets and traceability

- `scrub()` (`packages/shared/src/scrub.ts`) is a pure function and is applied **twice on
  purpose**: in `agents` before anything reaches the model, and in `core` when persisting. It is
  idempotent. If you open a new way for text to come in, route it through one of those two points.
- No secrets in the repo: `.env` is ignored and `.env.example` is the template. A test checks the
  template does not lie in either direction.
- Every unit of knowledge keeps its **source, date, author, confidence, status and validity**. Do
  not turn an inference into a fact: whatever comes out of a model enters with low confidence.
