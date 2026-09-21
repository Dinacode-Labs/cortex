---
name: cortex-capture
description: >-
  Save into Cortex, the project memory, what this task taught the project. Use it the moment the
  user decides, confirms, rejects or corrects something; when you fix a bug and know its root
  cause; when a convention, a constraint or a workaround appears; when you finish a piece of
  development work; and when the user says "save this to Cortex", "remember this" or "record that
  decision". It closes the loop: you work, the project remembers.
---

# Capture protocol

The best writer of a project memory is the agent that was there when it happened, with the user
present. A summary written later has the *what* and has lost the *why*. So this is not a
report-at-the-end skill: it is a **trigger list you act on mid-task**.

The tool is `mcp__cortex__save_project_context` (`save_project_context` where there is no
prefix). One entry per fact; two facts are two calls.

## Triggers — call the tool immediately, without being asked

- **A decision was made.** Which option, and what it rules out.
- **The user confirmed a recommendation** — "go with that", "vale", "sí, así", "perfecto, hazlo" —
  **or rejected it** — "no, mejor X", "eso no". Save the rejection too: knowing what was turned
  down is what stops it being proposed again. Users often write in Spanish; the trigger is the
  confirmation, not the language.
- **A bug was fixed and you know the root cause.** The cause and the fix, not the symptom.
- **A convention or rule was established, or the user corrected yours.** A correction is the
  cheapest knowledge in the project and the easiest to lose.
- **A constraint from the client or the infrastructure surfaced.** A version that cannot be
  raised, a window when nothing deploys, a quota.
- **A non-obvious discovery about the codebase.** What the code does not say out loud and cost
  you time to find out.
- **A workaround went in**, with the reason it exists and what would let it go away.

## Self-check after every task

Ask yourself this, verbatim, before you answer:

> Did the user just decide, confirm, reject or correct me, or did I fix something with a root
> cause? If yes, save it now.

## Do NOT save

Task progress, tool or environment hiccups, open questions, what the repository already
documents, or secrets. In detail:

- **What you did this turn.** "Refactored three files", "tests are green". That is the reply to
  the user, not knowledge about the project.
- **Session-local hiccups.** A flaky command, a container that had to be restarted, a stale
  dependency on your machine. Nobody else will hit them in the same shape.
- **Open questions and options still under discussion.** Save the decision when it is made, not
  the deliberation.
- **Anything the repository already documents** — `CLAUDE.md`, the README, an ADR, a rule file.
  The code and its docs are already read; a copy in the memory only gets to be the stale one.
- **Secrets.** Tokens, keys, connection strings, customer data. Cortex strips what it
  recognises, and that is a net, not a licence.

A memory full of noise is worse than an empty one, because people stop reading it.

## Format

- **`title`**: verb + object, 100 characters at most. "Postgres stays on 16 until pgvector 0.9
  ships", not "Database notes". A title that reads like a decision is what makes the entry
  findable.
- **`content`**: four labelled lines, in this order. Drop **Learned** when there is none.

  ```
  What:    one sentence — what holds now
  Why:     the reason, or the user's own words
  Where:   the files or modules it lives in
  Learned: the gotcha somebody else would trip over
  ```

- Write **declarative facts**, not orders: "Repositories use in-memory fakes in tests", not
  "Always use in-memory fakes". An order gets re-read as an instruction by the next session and
  starts governing work it was never about.
- **`type`**: only when you are sure. Cortex classifies otherwise, and a wrong label is worse
  than no label.
- **`confidence: "high"`**: only when the user stated or confirmed it. Omit it for what you
  inferred yourself — an inference entering as a fact is how a memory stops being trusted.
- **`sourceType: "claude_code"`**, and `sourceReference` with the ticket or PR when there is one.

Example:

```
save_project_context({
  project: "acme-portal",
  title: "Invoice totals are recomputed on read, never stored",
  content:
    "What: the invoice total is derived from its lines on every read.\n" +
    "Why: the user rejected a stored column — «no, mejor calcularlo»; the 2026-08 mismatch " +
    "came from a total that was saved and never updated.\n" +
    "Where: packages/core/src/invoice.ts, the /invoices/:id route.\n" +
    "Learned: the API returns a number with no currency; the web formats it.",
  confidence: "high",
  sourceType: "claude_code",
})
```

## Delivery

Memory work is **internal bookkeeping**. Finish the save before your final answer, and never make
the save the answer: the user asked for the work, not for a report on what you filed. One line at
the end — "saved to the project memory" — is enough, and even that only when it earns its place.

## Read before writing

Starting on a module: `mcp__cortex__get_project_context_pack` for the briefing, or
`mcp__cortex__ask_project_context` for a specific question. Saving without reading is half a
loop, and the half that duplicates what is already there.

## Duplicates and contradictions

If the tool's answer flags a **duplicate** or a **contradiction**, do not save a second copy:
say so to the user, with both versions, and let them decide. Two entries that disagree are how a
project memory stops being trusted.
