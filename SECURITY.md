# Security policy

## Reporting a vulnerability

**Please do not open a public issue.** Use one of these instead:

- **GitHub Security Advisories** (preferred): the *Security* tab → *Report a vulnerability*.
- **Email**: `security@dinacode.com`.

Tell us which version, how to reproduce it, and what impact you think it has. We reply within
**5 working days** with a first assessment and keep you posted until it is closed. If the
report holds up, we credit the reporter in the release notes unless they would rather we did
not.

## Supported versions

Only the **latest published minor**. Cortex is `0.x`: while that lasts, a minor release may
break compatibility, and security fixes are not backported to earlier versions.

## Scope

Everything in this repository is in scope: the HTTP API (`apps/server`), the web UI
(`apps/web`), the MCP server (`apps/mcp-server`), the CLI and the `packages/`. We are
especially interested in:

- Getting around a project's access control — reading or writing somebody else's project.
- Leaks across projects in search, `ask`, the context pack or the graph.
- Anything wrong with the one-time-code login: brute force, code reuse, session fixation.
- Injection (SQL, XSS in the server-rendered UI) or code execution.
- Secrets escaping: credentials that end up persisted, sent to the language model provider,
  or written to logs.

Out of scope is whatever depends on how you deploy it. An instance without TLS, without
`CORTEX_AUTH_DOMAIN`, or with the email provider left on `log` **in production** is an
insecure configuration, not a bug in the code. The server warns about all three at startup
anyway.

## How we handle secrets

- Never in the repository. `.env` is ignored; `.env.example` is the template.
- There is a secret scrubber (`scrub`, in `@cortex/shared`) applied **twice**: before
  anything reaches the language model, and again before anything is persisted. The server
  does not trust the client to have cleaned up. It is a last line of defence, not a
  guarantee: if you think it misses a common pattern, that is worth reporting.
- CLI credentials live in `~/.cortex/credentials` with `600` permissions.

## Dependencies

`pnpm audit` runs on every CI build, **informational rather than blocking**, and Dependabot
opens weekly PRs. Why it does not block: there are high-severity **transitive** advisories in
`mammoth`, `@modelcontextprotocol/sdk` and `@mastra/core` that we cannot fix until those
projects publish. A gate that fails from day one gets switched off and stops meaning
anything; we would rather see it on every build and update as soon as there is a version.

`xlsx` is installed from the official SheetJS CDN (`cdn.sheetjs.com`) instead of npm, because
the npm release is abandoned and still carries CVE-2023-30533 and CVE-2024-22363. Dependabot
**does not follow** tarball URLs, so this one needs a manual check every quarter.

## A note on the history

This repository is public, history included. The history before it was opened is working
material, not product: it is not maintained, not cited, and not to be taken as current. What
describes Cortex today is the tree you are looking at and the decision records in
`docs/decisions.md`.
