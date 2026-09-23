---
name: cortex-recall
description: >-
  Ask Cortex, the project memory, before answering a question about THIS project. Use it when the
  question is about how this project does something, why it is the way it is, whether something was
  already decided, tried or broken before, what the convention or the constraint is, or what to
  watch out for in a module — and use it even when the repository looks like it already answers,
  because `.claude/`, the README and the ADRs hold the rules while the memory holds what the project
  learned the hard way. Also when the user says "what do we know about…", "did we already…", "ask
  Cortex", "what does the memory say", or the equivalent in their own language.
---

# Lookup protocol

The context pack injected when the session opened is a **sample of the memory, not the memory**.
Its header says how many entries it is showing out of how many exist, and every section that had
to cut says how many it left behind and how to ask for them. Those numbers are the point: a pack
showing 25 of 349 has left out 324 entries, and the one you need is as likely to be there as here.

The failure this exists to stop: a question arrives, it sounds like a question about the
repository, a rule in `.claude/` answers it coherently, and the answer ships. It was never wrong —
it was just the rules, and the project had also learned something by running into the problem.
That half is only in the memory.

## Triggers — ask before you answer

- **A question about how this project does something**, or why it is the way it is.
- **"Have we already…"** — decided this, tried this, hit this bug, rejected this approach.
- **A convention or a constraint** you are about to state from a rules file or a README.
- **Before touching a module** you have not worked on in this session.
- **The user's first message names a feature, a module or a problem.** Search it with their own
  words before replying; prior work on it is the cheapest thing you can know.
- **The user asks the memory directly** — "what do we know about…", "ask Cortex", or the same
  thing in their own language.

## Self-check before every answer

Ask yourself this, verbatim:

> Am I about to answer something about this project out of the repository alone? If yes, ask the
> memory first.

## Which tool

- **`search_project_context`** — the default. A question in your own words; add
  `type: "decision" | "constraint" | "convention" | …` to pull back exactly what a pack section
  truncated. This is the one the pack's `…more not shown` lines point at.
- **`ask_project_context`** — a plain-language question answered from the entries, with its
  sources. Use it when you want the answer rather than the list.
- **`get_project_context_pack`** — the briefing again, and with `area: "<module>"` a version
  weighted towards what you are about to touch.
- **`list_project_decisions`** — what was decided, most recent first.

They are prefixed per host: `mcp__cortex__search_project_context`, or
`mcp__plugin_cortex_cortex__search_project_context` when the plugin scopes the server.

## If the tools are not loaded

A current server marks the read tools to load from the first turn ([ADR-0075](../../../../docs/decisions.md#adr-0075)), so this
is for an older one.

Ask for them in your **first** batch of calls, not after it: `ToolSearch` waits for a server that
is still connecting, so a Cortex still listed as connecting is not a reason to start without it.

```
ToolSearch: select:mcp__cortex__search_project_context,mcp__cortex__ask_project_context,mcp__cortex__get_project_context_pack,mcp__cortex__list_project_decisions
```

If nothing resolves, say the memory was unreachable and answer from the repository — but say which
one you answered from. A silent fallback is how an agent reports a rule as if it were experience.

## What the memory is not

- **Not a substitute for reading the code.** It says what was decided and what went wrong, not
  what the file says today. The code wins over the memory, as it wins over the docs.
- **Not a place to guess from.** Nothing relevant came back is an answer: say so, and say you are
  answering from the tree instead.
- **Not the whole truth about an entry.** Pack lines and search hits are summaries; the entry's
  own content is longer, and its `confidence` and `status` tell you how much to lean on it. An
  entry at `low` confidence is somebody's inference, not a fact.

## After the lookup

If what came back was wrong, stale or contradicted by the code, that is knowledge too: see the
`cortex-capture` skill. Reading without ever writing back is half a loop.
