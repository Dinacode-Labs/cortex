# Evaluation sets

Two fixed sets, one per half of the pipeline: **retrieval**, what can be found of what is
already stored, and **distillation**, what gets stored in the first place. Both exist to answer
the only question that matters when the chunking, the rerank, the embeddings or a prompt get
touched: **did it get better or worse?**

```
retrieval/        corpus.json · questions.json
distill/
  en/             windows/ · gold.json     the default
  es/             windows/ · gold.json     the same eight cases in the language of the corpus
```

One directory per set, and inside distillation one per language, each carrying its own windows
and its own marking key. Neither half is the implicit one: the first set in does not get to sit
in the root and the first language in does not get to be the one with no suffix, or whatever
arrives second is an afterthought bolted onto a name.

These are **not tests**, which is why they live here and not under `tests/`: they put a mark on
a model, so they need a real provider, they cost money and minutes, and they are launched by
hand — CI never runs one. What does run on every commit is what guards them, with no model
involved: `tests/eval-*.test.ts`, which mark both the markers and the sets themselves. How one
of these is built, and what has to be true of it: `.claude/rules/evals.md`.

## Why an invented corpus and not the real memory

Because an eval exists to compare runs, and the real memory changes every day: the same code
change would give different numbers depending on what had been captured that week. It also
means anyone who clones the repo can run it, with no access to any server.

The corpus imitates what Cortex really accumulates -- decisions with their reasoning,
constraints, incidents, conventions, debt -- about a fictional project: **Nébula**, a service
that receives documents, processes them and bills for them. The distillation windows are
sessions about that same project.

> **The corpus, the questions and the windows are in Spanish on purpose.** They are data, not
> our prose: they mirror the language of the corpus Cortex actually ingests, which is what the
> baseline below was measured against. Translating them would change the numbers and would stop
> this measuring what it exists to measure.

## Retrieval eval

### How to run it

```bash
pnpm admin eval                    # the fixed corpus, a temporary project, deleted afterwards
pnpm admin eval --keep             # keeps the project so it can be inspected
pnpm admin eval --project "X"      # against a real project, with your own questions
```

**A real embedding provider is required.** With `EMBEDDINGS_PROVIDER=local` the numbers mean
nothing: it is a word hash, it does not understand that "how much can a document weigh" and
"upload size limit" are the same thing. The command warns and carries on, because seeing the
wreckage teaches something too.

### What is measured

- **recall@5**: of the entries that answer the question, what fraction appears in the first 5
  results. With several pieces of evidence, getting one right is not getting it right.
- **MRR**: 1 divided by the position of the first correct piece of evidence. It measures
  whether the good stuff comes out on top or you have to scroll down.

The questions are labelled by type so the numbers can be read separately: a drop only in the
paraphrased ones points at the embeddings; only in the spread-out ones, at the chunking.

### Baseline (2026-09-12)

> **Updated the same day**: once the question's type is inferred (see below) it moves to
> recall@5 **0.987** and MRR **0.928**. The table here is from before that change, which is
> what it was compared against.

With `qwen3-embedding` (4096 dim), hybrid search, no LLM rerank:

| type | n | recall@5 | MRR |
| --- | --- | --- | --- |
| direct | 8 | 1.000 | 1.000 |
| paraphrased | 15 | 1.000 | 0.850 |
| reasoned | 5 | 1.000 | 1.000 |
| multiple | 10 | 0.850 | 0.850 |
| **TOTAL** | **38** | **0.961** | **0.901** |

The two questions with no answer in the corpus score 0.472 and 0.370 on their best result, far
below what comes out when the answer is there. That is a good sign: the memory does not pretend
to know what it does not know.

#### What this baseline already says

Paraphrased content is retrieved in full (recall 1.000): the embeddings do their job and there
is no sign of context loss from chunking. **That is exactly what Contextual Retrieval was being
deferred over, and this number says it is still not needed.**

Where it falls down is the spread-out questions, and one fails entirely:

> "¿Qué deuda técnica hay alrededor de la facturación?" → 0 out of 2

All five results are about billing and **none is of type `technical_debt`**. Semantic similarity
swallows the type: when the question names a domain category -- "technical debt", "what did we
decide", "what constraints are there" -- the search ignores it and returns whatever is closest
by topic. The API already accepts filtering by type; nobody infers it from the question.

That thread has since been pulled, with measurements: the search **infers the question's type**
when it names a category, and nudges that type upwards without filtering by it -- filtering
would lose the answer when it is stored under another type. Result:

| | recall@5 | MRR | spread-out (recall) |
| --- | --- | --- | --- |
| before | 0.961 | 0.901 | 0.850 |
| after | **0.987** | **0.928** | **0.950** |

Without touching anything else: direct, paraphrased and reasoned stay at 1.000, and the
questions with no answer move by less than a thousandth (0.472 → 0.473), so the nudge does not
make the memory pretend to know what it does not.

The size of the nudge (`CORTEX_SEARCH_TYPE_BOOST`) was chosen by measuring, not by eye: between
0.12 and 0.20 the result is identical and it is the best; below that it falls short, and from
0.30 recall drops again, because it starts letting in entries of the right type but the wrong
subject. It sits at 0.15, the centre of that plateau.

## Distillation eval

`distill/` measures the step *before* retrieval: out of an agent session, what the distiller
keeps, what it drops and what it files under the wrong type. Until it existed, every change to
the distiller's prompt was an opinion.

A window is a slice of a condensed session in the format `condenseSession` produces
(`packages/client/src/transcript-utils.ts`): `USER: ` and `ASSISTANT: ` turns separated by a
blank line, up to 9,000 characters. `gold.json` carries one entry per window: `expected` lists
what has to come out -- a type plus the keywords that must appear in the title or the content --
and `forbidden` the keyword sets that must not appear in any item.

### What each window tests

| window | what it holds | expected |
| --- | --- | --- |
| `a-decisions.txt` | three decisions with their rationale, taken by the user | 3 decisions |
| `b-confirm-reject.txt` | two options proposed; one confirmed ("vale, la B"), one rejected | 1 decision |
| `c-open-discussion.txt` | options weighed and nothing decided at the end | nothing |
| `d-incident-vs-hiccup.txt` | a real incident with root cause and fix, next to a hiccup local to the session | 1 incident |
| `e-narration.txt` | tool narration and progress only | nothing |
| `f-convention.txt` | a convention given as an order ("a partir de ahora siempre…") | 1 convention |
| `g-exploration.txt` | a one-off exploration that reaches no conclusion | nothing |
| `h-trivial.txt` | acknowledgements only | nothing |

Half of the set expects **nothing**, and that is the point: recall is cheap to buy by keeping
everything, and a memory full of narration, hiccups and abandoned ideas is worse than an empty
one, because what reads it is an agent that cannot tell which is which.

### How to run it

```bash
pnpm admin eval-distill                       # en, the default
pnpm admin eval-distill --lang es             # the same eight cases in the corpus's language
pnpm admin eval-distill --verbose             # plus every item: type · title · first 120 chars
pnpm admin eval-distill --windows <dir> --gold <file>   # a fixture from outside the repo
```

**An LLM is required, and the command refuses to run without one.** The distiller *is* the
model: there is no heuristic underneath it, so with `LLM_PROVIDER=none` every window comes back
empty and the table would print a perfect zero that says nothing. Measure with the model you
actually intend to distil with; the numbers are not portable between models.

### What is measured

- **expected recall**: matched expectations / total. Aggregated over the expectations, not
  averaged per window: with four windows expecting nothing, a per-window average would let a
  distiller that emits nothing at all score 0.500.
- **forbidden leaks**: forbidden keyword sets found in some item / total. This is what stops
  recall from being bought with noise.
- **mistyped**: items carrying every keyword of an expectation but under another type. It is
  reported apart from a miss because it is a different failure: knowledge under the wrong type
  is not lost, it is unreachable -- the search infers the type from the question, so a decision
  filed as a note stops answering "what did we decide".
- **items per window** and **windows with zero items**: the shape of the output. A prompt that
  doubles recall by emitting five items per window has not improved anything.

Keywords are matched case- and accent-insensitively (`canonicalize`), because the corpus is
Spanish and a model writes "facturación" or "facturacion" depending on the day. One item answers
for one expectation at most: a single item summarising the whole session must not count as three
hits.

What the keywords cannot tell apart is "decided X" from "discarded X" -- a well-written decision
often names the alternative it rejected, and that is knowledge, not a leak. That is why
`b-confirm-reject.txt` forbids only the idea nobody answered, and why what the window is really
for is read with `--verbose`.

### One set per language

The same eight cases exist in English and in Spanish. Each language is a directory of its own
with its **own windows and its own gold**, because the two are useless apart, and adding a third
is copying a directory rather than editing anything. They are run **separately, with their own
mark**: mixed into one total, a gain in one language would hide a loss in the other and the
number would stop saying what happened.

There is an asymmetry worth knowing before reading either number. **The distiller answers in
Spanish whatever it is fed** -- `OUTPUT_LANGUAGE` in `packages/agents/src/mastra.ts` is fixed,
and changing it is a product decision, not a translation. So:

- **`es`** is the session and the corpus in the same language: it measures the judgement alone.
- **`en`** is a session that crosses into another language on the way out. It measures whether
  the judgement survives that crossing, which is the situation a public repository actually
  meets, and it is the default.

That crossing is also why the English key is annotated only with **language-invariant
keywords**: names and identifiers (`ULID`, `UTC`, `Redis`, `Kafka`, `OOM`, `ocr.ts`) and stems
(`idempot`, `retroactiv`, `memor`). Annotate it with Spanish words and the window would be
measuring the translation rather than the judgement, which is a different question and one
nobody asked. There is a test for it (`tests/eval-distill-fixture.test.ts`), along with the rest
of what breaks in silence here: a window with no entry in the key, a keyword that is nowhere in
its own window, a type that is not in the domain.

The sets are deliberately the **same eight cases**, so that read side by side they answer the
question worth asking: does the distiller lose anything when the session is not in the language
of the corpus?

### Baseline

**Pending a run against a real provider, for both sets.** The table goes here, dated and naming the model, as
the output of `pnpm admin eval-distill`. It has to exist before the distiller's prompt is
touched: a set like this is only worth anything as a comparison between two runs, and there is
no point arguing about the second one if the first was never taken.
