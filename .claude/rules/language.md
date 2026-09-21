# Language

**The repository is in English — all of it** (ADR-0064). Code and comments, tests and their
names, the ADRs, the roadmap, the research notes, the CHANGELOG, commit messages, CLI output, MCP
tool descriptions, the web UI, API errors, and these rules.

It was bilingual until 18 September 2026, with the team's working record in Spanish. Once the
repository went public, the half a reader could not parse turned out to be the half explaining
**why** things are the way they are — the comment above the function saying which bug a
workaround exists for.

## What stays in Spanish, and why

Two things, and the rule that separates them is that they are **data rather than prose we wrote**:

1. **Patterns that match the corpus**, which is Spanish: `CLASSIFY_RULES`, `MODULE_KEYWORDS` and
   `polarityTags` in `packages/core/src/text.ts`, the deictics regex in
   `packages/shared/src/domain.ts`, and the eval sets in `evals/` — the baseline was measured
   against them, so translating them silently invalidates every comparison.
2. The **output language** of the LLM agents (`OUTPUT_LANGUAGE` in
   `packages/agents/src/mastra.ts`). The prompts are English; what the agents produce is stored
   next to a corpus that is already Spanish. Changing it is a product decision, not a translation.

Values an external system owns keep their own spelling for the same reason: Plane's `'Histórico'`,
Notion's property names, migration filenames.

## If you add one

Add the path to `SPANISH_ON_PURPOSE` in `tests/docs.test.ts` **and** leave an English comment in
the file saying why. **An exception that is not written down is indistinguishable from an
oversight**, which is how the previous convention decayed. The test checks both: that every
exempted path still exists, and that each one explains itself.

`README.es.md` and `CONTRIBUTING.es.md` are kept as Spanish entry points, deliberately not
line-by-line translations. The English versions are the ones that must be current when the two
disagree.
