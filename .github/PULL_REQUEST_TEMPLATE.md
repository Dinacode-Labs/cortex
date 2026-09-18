## What changes, and why

<!-- The why matters more than the what: the diff already tells the what. -->

## How you verified it

<!-- What you ran and what came out. If something went untested, say so. -->

## Checklist

- [ ] `pnpm typecheck` green
- [ ] `pnpm test` green
- [ ] `pnpm test:integration` green (if you touched core, database or the HTTP apps)
- [ ] Docs updated **in this PR**: `README.md`, `docs/decisions.md` (an ADR when the decision
      carries weight), `docs/roadmap.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.env.example`
- [ ] A line added to `CHANGELOG.md` under `[Unreleased]`
- [ ] No secrets, no clients by name and no people as owners (ADR-0026)
