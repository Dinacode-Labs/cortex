---
paths:
  - "evals/**"
  - "tests/eval-*.test.ts"
  - "apps/admin/src/eval/*.ts"
  - "apps/admin/src/commands/eval*.ts"
---

# Evals: measuring what a model does

A test says pass or fail over code that always answers the same. An **eval** puts a mark on a
model, which never answers the same twice: over one conversation it writes "thumbnails are
generated on upload", and on the next run "it was decided to build the thumbnail when the
document is uploaded". Both are right, and neither can be asserted on. So what gets built
instead is an **exam with a marking key**.

Reach for one when the thing being changed is a prompt, a threshold or a model, and the only
defence available today is two hand-picked examples. That is the same as no defence.

## The shape

Four pieces, and the names in `evals/` are the reference:

- **The exam**: a fixed set of inputs in the repo, **invented**, never real data. An eval exists
  to compare runs; real data changes every week and the same code change would score
  differently for reasons nobody can see. Invented also means anyone who clones the repo can run
  it.
- **The marking key** (`gold.json`): one entry per input, saying what has to come out and what
  must not. Not the expected text: the **keywords** that have to be in it, plus the type.
- **The examiner**: a command in `apps/admin` that runs the model and prints a table.
- **The marker**: a **pure function** that compares what came out against the key, taking no
  model, no database and no filesystem. It goes in a file of its own **outside `commands/`**
  (`apps/admin/src/eval/`): that directory holds commands, each exporting `run(args)` and each
  registered in the dispatcher, and there is a test for it.

## Where it lives

An eval is **not a test**. It needs a model or a real provider, it costs money and minutes, and
it is launched by hand: nothing in CI ever runs one. So the exam and its key live in a tree of
their own at the root — `evals/<set>/`, one directory per set — and never under `tests/`, where
everything is expected to run on every commit and to pass.

What does stay in `tests/` is what guards them: the marker's tests and the ones that check the
set itself (`tests/eval-*.test.ts`), ordinary unit tests that touch no model, no database and no
network. The examiner is a command in `apps/admin/src/commands/`, and the marker sits beside it
in `apps/admin/src/eval/`, one file per set.

## Marking

- **Keywords and type, never the exact text.** Compared with `canonicalize` (case- and
  accent-insensitive) so that the same answer does not score differently on two runs.
- **One answer covers one expectation at most.** Otherwise a single item that summarises
  everything scores three hits, which is precisely the failure being hunted.
- **Half the exam expects NOTHING.** Any score is trivially bought by keeping everything, so
  there have to be inputs whose right answer is silence, and keyword sets that must not appear
  in any answer. Without those, the mark measures volume rather than judgement.
- **Aggregate over the expectations, not over the inputs.** With half of them expecting nothing,
  a per-input average lets a model that emits nothing at all score 0.500 and look half right.
- **Report the failure lines, not only the total.** A number that does not say which input it
  came from cannot be acted on, and a `--verbose` that prints every answer is what tells a
  regression from a bad marking key.

## Writing the marking key

- **Every keyword has to appear in its own input.** One that does not is either a typo or an
  expectation only an invented answer could satisfy — and neither shows up as an error, only as
  a slightly worse number that gets blamed on the prompt.
- **Use stems where the ending is not the point** (`retroactiv`, `idempot`, `memor`): the model
  will pick its own inflection and the key has to survive it.
- **Watch what the output language is pinned to.** `OUTPUT_LANGUAGE` makes the agents answer in
  Spanish whatever they are fed, so a set written in another language can only be annotated with
  keywords that survive translation: names, identifiers and stems. Annotate the output language
  instead and the set measures translation rather than judgement.
- **Keep populations apart.** Two languages, two domains or two models do not share a total: a
  gain on one hides a loss on the other. One mark per set, one directory per set, and each one
  carrying everything it needs (`distill/es/`, `distill/en/`): the halves of a set are useless
  apart, and adding one has to be copying a directory rather than editing the command. Neither
  the first set in nor the first language in gets to be the implicit one.

## What must not be left to memory

- **The marker and the fixture get ordinary tests.** Both break in silence: running the eval
  costs money and minutes, so an unmatchable keyword, an input with no entry in the key, or a
  type that is not in the domain does not fail, it just scores slightly lower. `tests/eval-*`
  covers exactly that, with no model involved.
- **A command that needs a model refuses to run without one.** With `LLM_PROVIDER=none` every
  answer comes back empty and the table prints a perfect zero, which reads the same as a prompt
  that keeps nothing.

## The baseline

A set is worth nothing until the **first run exists**, dated and naming the model. Without it
there is nothing to compare the second one against, and the prompt change goes back to being an
opinion. Write it next to the set, in `evals/README.md`, with the model it was measured with,
and **never invent it**: an eval whose numbers nobody ran is worse than no eval, because it
will be quoted.
