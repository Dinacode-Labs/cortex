---
paths:
  - "**/*.ts"
---

# Code style

There is no ESLint and no Prettier, and that is deliberate (ADR-0065): style holds by imitating
the file in front of you. Which is why it is worth writing down.

## Formatting

Two spaces, **double** quotes always, semicolons, lines up to about 120 columns. Do not reformat
code you are not touching: a formatting diff hides the real change.

## Modules

- ESM **NodeNext**: relative imports carry the `.js` extension even though the file is `.ts`.
- `verbatimModuleSyntax` is on → `import type { X } from "…"` explicitly for types.
- **No `export default`.** Named exports, and each package publishes through its `index.ts`.
- In `core` the barrel is an **explicit list** of what is exported, not `export *`: it forces a
  decision about what is public API.

## Types

- `interface` for objects and for a function's options; `type` for unions, aliases and function
  types.
- **Explicit return type** on every exported function.
- Options in an object with a default (`opts: SaveContextOptions = {}`), and every field
  documented with what it does **and its default**.
- Classes only when there is real state or an interface to implement (`EmbeddingProvider`), and
  for domain errors the caller distinguishes (`NotAManagerError`, `ProjectNotEmptyError`).
- `strict` and `noUncheckedIndexedAccess` are on: use `!` only where the code has just guaranteed
  that index, and add a comment when it is not obvious.

## `any` and suppressions

- `any` **only at a boundary with a foreign format that has no schema**: transcripts from other
  agents, untyped APIs, SQL rows through `Row`. It never crosses into the domain: before reaching
  `core` it is validated with zod or mapped to a type of our own.
- `@ts-ignore` and `@ts-expect-error`: **banned**. There are zero in the repo today; if you need
  one, the type is modelled wrong.

## Errors

- What is **expected** is not thrown, it is returned. A discriminated union for a guard's result
  (`AccessCheck`: `ok | not_found | forbidden`), `null` for "there is none".
- Throw when it is a **caller bug**, and say so in the message:
  `throw new Error("checkProjectAccess: needs 'name' or 'slug' (caller bug).")`.
- Uncaught errors rise to the app's `onError`: full log on the server, generic response to the
  client. **Never** leak internals to the caller.
- **Degrade rather than break**: a healthcheck with a timeout, an invalid logo falling back to the
  wordmark, a hook returning an empty pack when the project disappears mid-request. What is not
  acceptable is a `catch` that swallows everything: catch the specific case and let the rest rise.

## Size and shape

- Small files: none reaches 500 lines today. One file, one subject. **No `utils.ts`** as a junk
  drawer.
- Explicit precedence, on one readable line: what the caller asked for > what the LLM says > the
  heuristic (`parsed.type ?? llm?.type ?? classifyType(content)`).
