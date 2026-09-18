# Demo script — Cortex

The sequence for showing the working demo (sections 15 and 20.8 of the plan). It assumes
Postgres is up and the data is seeded (`pnpm db:up && pnpm db:migrate && pnpm db:seed`) and the
MCP is connected to the agent (see `config/README.md`).

Scenario: the **Acme Portal** project, client **Acme Corp**, a Laravel + Vue + PostgreSQL
stack, with a sensitive legacy billing module.

## 1. The problem

A project's context lives scattered around (decisions, constraints, incidents). A new developer
takes weeks to acquire it. Cortex centralises it and serves it to people and to Claude Code
alike.

## 2. Checking the context before touching a module (section 15.3)

In Claude Code:

> Before modifying Acme Portal's billing module, check Cortex with
> `get_project_context_pack` and tell me what I should keep in mind.

Expected result: the decisions in force (keep the legacy module), the client's constraints
(their own infrastructure), the risks (a sensitive module), the technical debt (no tests), the
sensitive modules and the incidents relevant to that area.

## 3. Storing context with low friction (section 15.2)

> Save this Acme Portal decision to Cortex: "A cache was added to billing's PDF generation to
> avoid timeouts on large exports."

Cortex classifies the type, extracts the entities (billing), generates the embedding and makes
it available. There are no long forms to fill in.

## 4. Semantic / relational search (section 15.6)

> Search Cortex for similar incidents related to document generation.

It returns the earlier timeout incident and the resolved TASK-123 ticket.

## 5. The improvement loop: a contradiction (section 15.5)

> Save to Cortex (Acme Portal): "The legacy billing module will be removed in the next
> release."

Cortex detects the **contradiction** with the decision in force to keep it, and asks for a
human to look rather than accepting it blindly.

## 6. Validation

> Mark entry `<id>` as validated in Cortex.

(with `validate_context_entry`).

## 7. Ready for Codex

The MCP tools are neutral: any tool that speaks MCP (Codex, ChatGPT, internal bots) can consume
the same layer with no changes to Cortex.

## What it demonstrates (section 21)

1. Knowledge gets in with little friction.
2. There is real orchestration, not a single call to a model.
3. MCP connects Claude Code without coupling everything together.
4. The system retrieves useful context, not merely similar-looking documents.
5. Cortex improves the knowledge (duplicates, contradictions, validation).
