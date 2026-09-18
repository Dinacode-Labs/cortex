---
paths:
  - "packages/agents/**/*.ts"
---

# The LLM layer

`agents` is the only layer that talks to a model, and `core` never imports it: it implements the
hooks `core` declares and wires them in `wire.ts` (see `architecture.md`).

- **A new role** means `AgentRole` + `INSTRUCTIONS` + registration in `mastra.ts`, and in
  `JSON_ROLES` if it returns JSON. The prompts are in English; `OUTPUT_LANGUAGE` is what decides
  the language the agents answer in, and it stays Spanish on purpose (ADR-0064) — changing it is a
  product decision that would split every memory already stored.
- Each role can have its own model (`CORTEX_MODEL_<ROLE>`, ADR-0023): cheap for the mechanical
  work, capable for judgement. Same OpenAI-compatible endpoint; only the model id changes.
- **Everything heading for the model goes through `scrub()` first.**
- What the model returns is an **inference**, not a fact: it enters with low confidence and with
  its source. Traceability is non-negotiable — source, date, author, confidence, status, validity.
- A model failure **degrades**, it does not break: `core` has a heuristic for everything enriched
  here, and without `LLM_PROVIDER` the whole product still works.
- `agents` uses **zod v4** (Mastra requires it), isolated from the v3 the rest of the repo uses. Do
  not cross schemas.
- Usage is measured (`recordUsage`): what the intelligence costs is visible, not guessed.
