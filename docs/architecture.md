# Architecture

How the packages depend on each other, and how `core` is layered inside. The decision and the
alternatives are in [ADR-0085](decisions.md#adr-0085); this page is the map.

## The packages

```
 apps/*  (server, web, mcp-server, admin)        start everything; the HTTP routes live here
    │
    ├──► agents        the LLM layer (Mastra); plugged into core through its hooks
    │
    └──► core          the domain and its use cases, in three layers (below)
            │
            ├──► database     utility: the Postgres client and the migrations
            ├──► embeddings   utility: the providers that turn text into vectors
            └──► shared       the contract between the CLI and the server, and env

 cli ──► client ──► shared    what is installed on a developer's laptop
```

`database` and `embeddings` know nothing about memos or projects. Only the infrastructure layer
of `core` uses them.

## Inside `core`

Every module (`knowledge`, `projects`, `graph`, `auth`, `capture`, `observability`) has the same
three layers:

| Layer | What goes in it | May import |
| --- | --- | --- |
| `domain/` | The aggregates and their rules, value objects, and the **ports**: the interfaces the module needs from the outside world (`MemoRepository`, an embedder, a mailer) | other `domain/` code, `text.ts`, `shared` |
| `application/` | The **use cases**: `saveContext`, `searchContext`, `getContextPack`… They work only through ports | `domain/`, `shared`, the composition |
| `infrastructure/` | The **adapters**: the implementations of the ports (`PgMemoRepository` with Postgres, the SMTP mailer, the document extractors) | anything, including `database`, `embeddings` and external libraries |

What several modules' adapters share, such as turning rows into memos and entities, lives in
`core/src/infrastructure/`, which follows the same rule as any `infrastructure/`.

One file, `composition.ts`, says which adapter answers each port. A use case asks it for the port
it needs and never builds an adapter itself. A test, or a deployment that wants another
implementation, replaces one with `configureCore()`. Swapping Postgres for another library means
writing another implementation of the port in `infrastructure/` and pointing the composition at
it; no use case and no domain rule changes.

The LLM arrives the same way, through hooks that `agents` wires in one place (`wireLlm()`), so
`core` keeps working without a model.

## Where the migration stands

The rules above are checked by `tests/core-layers.test.ts`. Files that do not follow them yet are
listed there, each with the step that moves it, and the test fails both when a new file breaks a
rule and when a listed file no longer needs to be listed.

1. ✓ The decision, this page and the test.
2. ✓ `composition.ts` and `configureCore()`, taking over the three repositories that already exist.
   A test runs a use case on a fake with `configureCore({ projects: fake })` and `resetCore()`
   after it, with no database.
3. One step per module. Use cases move into `application/`, SQL and libraries into
   `infrastructure/`.
   - ✓ `observability`
   - ✓ `graph`
   - ✓ `projects`
   - ✓ `auth`
   - ✓ `knowledge`: embeddings and search behind `MemoIndex`, the reads behind `MemoReader` and
     `HealthReader`, and the use cases in `application/`
   - ✓ `capture`: session captures, code indexing (`SourceTree`, `CodeIndex`) and document extraction
4. ✓ `core` stops depending on `client`.
5. The domain that still lives in `shared` moves into its module in `core`.
