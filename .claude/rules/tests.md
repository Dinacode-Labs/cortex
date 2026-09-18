# Tests

`pnpm typecheck` and `pnpm test` green, always. `pnpm test:integration` when you touch `core`,
`database` or the HTTP apps.

## Where each one goes

- **Unit** (`tests/*.test.ts`, `pnpm test`): pure, deterministic logic — schemas, permissions,
  slugs, session parsers, version compatibility. No database, no network.
- **Integration** (`tests/integration/*.test.ts`, `pnpm test:integration`): against a real Postgres
  (`cortex_test`), `local` embeddings and `LLM_PROVIDER=none`. Hermetic: no network, no keys. They
  cover persistence and search, hierarchy and inheritance, permissions and cascades, batch capture
  and auth. They need `pnpm db:up`; the `globalSetup` creates and migrates the database.
- They share one database, so they run serially and each test isolates itself with a unique suffix
  (`RID`).

## The rule that sets this repo apart

> **Any rule that can be broken without noticing becomes a test.**

That is not rhetoric, it is what is already there: that the CLI does not put on weight
(`client-package.test.ts`), that `.env.example` does not lie (`env-example.test.ts`), that there
are no broken links, ghost ADRs, corporate material or Spanish left in the tree
(`docs.test.ts`), that every CSS class emitted has a rule behind it (`web-styles.test.ts`), that
the `dist/` actually starts (the CI smoke test).

Before writing a paragraph asking somebody to remember something, ask whether it can be a test. If
it can, make it a test.

## How they are written

- `describe` and `it` describe the **behaviour**, not the function's name:
  `it("the OTP is looked up on the line with THAT email, not the first number that turns up")`.
- Above the test, a block comment with **which incident it prevents**. A test without that why gets
  deleted by the first person who sees it fail.
- **Inject rather than mock** whatever the app already lets you inject (`createApp({ distill })`);
  exercise routes with `app.request()`, without standing up a port.
- An `expect` that shows **every** offender, not the first three: with three, you fix three and the
  fourth stays.

Add tests with your PR whenever you touch testable logic.
