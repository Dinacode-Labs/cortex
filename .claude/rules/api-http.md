---
paths:
  - "apps/server/**/*.ts"
  - "apps/mcp-server/**/*.ts"
---

# HTTP API and MCP

## An HTTP route

1. One router per resource in `routes/<resource>.ts`, mounted in `createApp()`. `createApp()` only
   composes and has no side effects: the tests exercise it with `app.request()` without opening a
   port, and anything expensive is injected (`AppDeps.distill`).
2. **Validate the body at the edge** with zod: `const body = await parseBody(c, schema);` then
   `if (body instanceof Response) return body;`. The schemas shared by client and server live in
   `packages/shared/src/api-contract.ts`, so they cannot drift apart silently.
3. **Authenticate and authorise before touching anything**: `currentUser(c)` →
   `checkProjectAccess(...)`. It is the **single** access policy (ADR-0046); `forbidden` is told to
   an outsider as "not found", and nobody invents their own rule.
4. Responses and errors in English. Uncaught errors are **not** caught here: they rise to
   `onError`, which logs the detail on the server and returns something generic.
5. `core` validates and scrubs again what it receives. That is deliberate: the server does not
   trust the client to have done it.

Adding an endpoint or a field is a contract change: whoever reads it tolerates its absence
(ADR-0062), because on the other side there may be a CLI from months ago.

## When a change breaks older CLIs

Adding is never breaking. What breaks is **removing or renaming** a route, a field or a value
that a shipped CLI sends or reads, or **tightening** a schema so that a body an older CLI sends
is now rejected. If your PR does that, it is your job, not the operator's, to raise the floor:

1. Bump the default of `MIN_CLIENT_VERSION` in `apps/server/src/version.ts` to the **first CLI
   version that survives the change**, which is the version this PR will ship in.
2. Say so in the CHANGELOG entry: "CLIs older than X can no longer write; run `cortex upgrade`".

The default in code is what every deployment gets. The `CORTEX_MIN_CLIENT_VERSION` variable is
an operator override, for a deployment that needs a higher floor for its own reasons; it is not
where compatibility breaks are recorded. Never raise the floor as a nudge to update: the passive
notice already does that without stopping anyone's work.

## An MCP tool

- They are registered in `apps/mcp-server/src/server.ts`, with `inputSchema` taken from the domain
  schema (`saveContextInput.shape`), not rewritten by hand.
- The title and description are read by a model that may be working in any language: keep them
  short and unambiguous.
- With `user` (authenticated HTTP) the write is attributed (`createdBy`) and permissions apply
  through the same `guard`; without `user` (local stdio) there is no guard.
- A failure comes back as `isError` with text the agent can act on, never as an exception.
