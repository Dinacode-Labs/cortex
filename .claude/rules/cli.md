---
paths:
  - "apps/cli/**/*.ts"
  - "apps/admin/**/*.ts"
  - "packages/client/**/*.ts"
---

# CLI and client

## What a command is

A command is one verb of one binary — `cortex link`, `cortex-admin migrate` — and its file is
the only kind of file in this repo whose job is the *edges*: reading `argv`, printing to a
terminal and deciding an exit code. What happens in between is not its own: a command **parses,
calls and prints**, and the doing belongs to `@cortex/client`, to a package, or to a sibling
module of its own.

That is the whole reason commands are a layer. Logic that lives inside one can only be reached by
starting a process and passing it strings, so it cannot be reused by the server or the web and
cannot be unit tested; the moment it moves one directory sideways, both come for free
(`tests/eval-distill-matcher.test.ts` imports `apps/admin/src/eval/distill-match.js` directly,
and no process is started).

## Where a command belongs

`cortex` is the **developer** CLI and installs through `npm i -g`: it may depend only on `client`
and `shared`. If the command needs the database, the model or to stand up a service, it belongs in
`cortex-admin`, which lives in the image (ADR-0025). `tests/client-package.test.ts` watches this.

## The contract with the dispatcher

Each binary is one dispatcher — `apps/cli/src/index.ts`, `apps/admin/src/index.ts` — holding a
`COMMANDS` map: the name typed in the terminal → a help line and a `load()`. Both sides promise
something.

**The file**: `<app>/src/commands/<name>.ts`, where `<name>` is what gets typed, exporting
`run(args: string[]): Promise<void>`. `args` is everything after the command's name, and the file
parses it itself — there is no shared parser and no argument library. Subcommands (`cortex mem
save`) are still one file and one `run`. Inside it, and nothing else:

- **Its own flag parsing** and its own `Usage:` line, printed when what it needs is missing.
  `apps/admin/src/commands/enrich.ts` is the whole shape in thirty lines;
  `apps/cli/src/commands/mem.ts` is the same thing with flags and subcommands.
- **No `process.exit`.** Failure is `process.exitCode = 1` and `return`, or a thrown error the
  dispatcher reports. Exiting by hand jumps over everything that comes after `run()`: closing the
  database pool in admin, the version notice in the CLI (ADR-0062).
- **No side effects at import time.** The module is loaded when its command is invoked, and a
  throw at import happens outside the dispatcher's `try`: instead of `cortex <cmd> failed: …` the
  user gets a raw stack trace for something they never got to run.
- **No library code** — that is the next section.

**The dispatcher**: one entry in `COMMANDS`, and the command is reachable.

- **The help line is that entry**, because the map *is* `cortex --help`. One line, lowercase, no
  full stop, saying what it does for whoever types it — not how it does it.
- **Loading is lazy and the path is literal**: `load: () => import("./commands/<name>.js")`. Lazy
  so that starting the binary costs what the command costs and nothing else: `--help` lists them
  all without executing one. Literal rather than `` import(`./commands/${sub}.js`) `` so the set
  of commands is decided in one readable place, and so the CLI can be bundled into the single
  file it publishes (`apps/cli/tsup.config.ts`).
- **`managed: false` means the command owns its own lifecycle**: servers and workers that never
  return, and the hooks and `cortex mcp`, which decide themselves when the process ends. The
  dispatcher awaits `run()` and stands back — no `try`/`catch` around it, no `closeSql()` in
  admin, and no version notice in the CLI, where the `managed: false` commands are exactly the
  ones whose stdout is protocol. Everything else is managed, which is the default and the right
  answer unless the command has to outlive the dispatcher or end the process on its own terms.
  (`versionNotice: false` is the small version of the same idea: the command already talks about
  versions itself.)
- **`loadEnv()` is the dispatcher's, `wireLlm()` is yours**: admin loads the environment before
  importing the module and wires nothing. A command that needs the model calls `wireLlm()` as the
  first thing inside `run()` (`apps/admin/src/commands/enrich.ts`), never at import time.
- A command can also be **another app's entrypoint**: `boot()` in admin wraps
  `@cortex/server/start`, which stands the server up on import. Those are `managed: false` and
  have no file in `commands/`.

## What is not a command

**`commands/` holds commands and nothing else.** Whatever a command needs and is not one itself
goes in a sibling directory and is imported from there: `apps/cli/src/setup/`,
`apps/cli/src/mcp/`, `apps/admin/src/eval/`. Parked in `commands/` it reads as a subcommand that
cannot be invoked, and nobody looking for library code finds it there. If a second binary — or
the server, or the web — needs it too, a sibling is no longer the place either: it is a package,
and `architecture.md` decides which.

`tests/cli-commands.test.ts` checks both halves: everything in `commands/` exports `run`, and
everything in `commands/` is registered. Both break in silence otherwise — the second one
typechecks, is imported by nobody, and is only noticed by somebody asking why their command is
unknown.

## Several servers, one client

The server comes from the repo's `.cortex.json`, not from a global variable (ADR-0033): go through
`useProjectServer(cwd)` before calling the API, and look the token up **per server** —
`readCredentials()` with no argument is not necessarily the right one.

## Compatibility

The CLI and the server are not in lockstep (ADR-0062): a 404 on a new endpoint means "old server"
and degrades; a new field is read as optional. The only thing that blocks is `minClientVersion`,
and only for writes (`apps/cli/src/compat.ts`, comparison in `apps/cli/src/version.ts`).

## Hooks and `cortex mcp`

`managed: false`, and **stdout is protocol**: not one byte more, not even the version notice.
There is a test. They are also guarded so that a missing CLI or an unreachable server never breaks
the agent's session.

## The splash

`cortex` with no arguments and `cortex version` print the Cortex mark (`apps/cli/src/splash.ts`,
drawn from `MARK_GRID` in `@cortex/shared`, the same drawing as the web header and the favicon).
Only on an interactive terminal, never in CI or with `TERM=dumb`, and only with the default brand:
an operator who set `CORTEX_BRAND_NAME` does not get the Cortex mark. `NO_COLOR` disables every
escape. Piped output does not change. The mark is visual judgement: no ADR for it.

## Connectors

`connect-<x>.ts`, reusing core's `extract` layer and writing through the authenticated API
(`/capture/batch`). Incremental by `sourceReference`.
