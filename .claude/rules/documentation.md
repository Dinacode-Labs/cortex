# Documentation and delivery

Documentation is part of the work, not an extra. A PR that changes behaviour without touching
documentation is half done.

## In the same PR

- `README.md` when capabilities, architecture, commands or structure change.
- `docs/decisions.md` when the decision carries weight (see below).
- `docs/roadmap.md`, `CONTRIBUTING.md`, `.env.example` and `CLAUDE.md`, according to what you
  touched.
- A line in `CHANGELOG.md`, under `[Unreleased]`: **what changes for whoever uses it**, not what
  you did. The release notes come from there, not from the commits.
- `CLAUDE.md` and these rules: keep them current **and prune them**. Short and true beats long and
  stale.

## ADRs

A fixed shape: **status · context · decision · alternatives · revisit when**. The numbers are
stable identifiers because they are cited from the code: never reorder or reuse them.

A decision is a **hypothesis to revisit**. What makes the log useful is the "revisit when", and
recording what did **not** work (Mastra workflows evaluated and dropped, Spanish-only full-text
search, a hardcoded price table) is what keeps it honest.

Before claiming something "works like this", check the file, function or flag you are citing still
exists. **The code wins over the docs.**

## What does NOT go in this repository

It is public (ADR-0026, ADR-0031): no clients by name, no people as owners of a piece of work, no
internal tooling, no branding of our own, no operational decisions (which provider, with which key,
at what cost), no security audits, no business priorities. That lives in the private repository.

Quick rule: if it helps somebody outside use, understand or improve Cortex, it is public; if it
describes how we operate it, it is not. When in doubt, it is not.

And when reporting a finding: **say what was found, not how it was found**. "This pair of entries
scores 0.86-0.88" teaches something; the rig that produced it ages badly and helps nobody outside.

## PR discipline

One PR per change, branched from `main`, narrowly scoped. No "while-I-am-here" fixes outside the
scope: if you find something broken that is not yours to touch, note it in the PR and move on.

Conventional commits, scoped by package:
`fix(core): the project slug resolves on reads too, and in one place (#136)`.
