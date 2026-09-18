---
paths:
  - "apps/cli/**/*.ts"
  - "apps/admin/**/*.ts"
  - "packages/client/**/*.ts"
---

# CLI and client

## Where a command belongs

`cortex` is the **developer** CLI and installs through `npm i -g`: it may depend only on `client`
and `shared`. If the command needs the database, the model or to stand up a service, it belongs in
`cortex-admin`, which lives in the image (ADR-0025). `tests/client-package.test.ts` watches this.

## How one is written

- `apps/cli/src/commands/<cmd>.ts` exporting `run(args: string[]): Promise<void>`.
- **No `process.exit` and no side effects at import time**: the dispatcher owns the lifecycle.
- Register it in `COMMANDS` (`apps/cli/src/index.ts`) with its help line. Loading is lazy and by
  literal path: `cortex --help` must not pay the cost of loading anything.

## Several servers, one client

The server comes from the repo's `.cortex.json`, not from a global variable (ADR-0033): go through
`useProjectServer(cwd)` before calling the API, and look the token up **per server** —
`readCredentials()` with no argument is not necessarily the right one.

## Compatibility

The CLI and the server are not in lockstep (ADR-0062): a 404 on a new endpoint means "old server"
and degrades; a new field is read as optional. The only thing that blocks is `minClientVersion`,
and only for writes (`apps/cli/src/compat.ts`, comparison in `apps/cli/src/version.ts`).

The floor is raised on the server side, by the PR that breaks compatibility (see
`api-http.md`, "When a change breaks older CLIs"), never from here. If a CLI change stops
working against older servers, that is not a reason to raise it either: degrade, or say plainly
that the server needs updating.

## Hooks and `cortex mcp`

They own their own lifecycle (`managed: false`) and **stdout is protocol**: not one byte more, not
even the version notice. There is a test. They are also guarded so that a missing CLI or an
unreachable server never breaks the agent's session.

## Connectors

`connect-<x>.ts` exporting `run(args)`, reusing core's `extract` layer and writing through the
authenticated API (`/capture/batch`). Incremental by `sourceReference`.
