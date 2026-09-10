---
name: cortex-capture
description: >-
  Save what this task taught the project into Cortex, the project memory. Use it when you
  FINISH a piece of development work, when the user says "save this to Cortex", "remember
  this", "record that decision", or right after something worth remembering happened: a
  technical decision, a resolved incident, a workaround, a constraint from the client. It
  closes the loop: you work, the project remembers.
---

# Save context to Cortex

When you finish a task, or the user asks, **summarise what happened and save it** to the
project memory with the `mcp__cortex__save_project_context` tool.

## When to save

- You closed a piece of development work that changed something that matters.
- A **technical decision** was made, a **client constraint** surfaced, an **incident** was
  resolved, or a **workaround** went in.
- The user asks you to.

Do not save noise: trivial edits, "ok", local experiments that concluded nothing. A memory
full of noise is worse than an empty one, because people stop reading it.

## How to save

1. **Work out which project this is.** Use the project name as it exists in Cortex, for
   example "Acme Portal". If it is genuinely unclear, ask in one sentence.

2. **Write a structured summary.** Keep only the sections that apply, and write it in the
   language the project uses:

   ```
   Summary:    what was done or decided, in one to three sentences
   Decisions:  what was decided and why; what was rejected and why
   Files:      the paths that matter
   Risks:      what is fragile here, what could break
   Open:       what is still pending
   Sources:    ticket or pull request, if there is one
   ```

3. **Call the tool:**

   ```
   mcp__cortex__save_project_context({
     project: "<project>",
     content: "<the structured summary>",
     type: "decision" | "incident" | "pr_summary" | "technical_debt" | "convention" | ...,
     sourceType: "claude_code",
     sourceReference: "<task or PR id, if any>",
     createdBy: "claude-code"
   })
   ```

   Leave `type` out if you are not sure. Cortex classifies it on its own, and a wrong label
   is worse than no label.

4. **Read the answer.** If Cortex flags a **duplicate** or a **contradiction** with what it
   already knows, tell the user instead of insisting. Two entries that disagree are how a
   project memory stops being trusted; suggest consolidating or validating one of them.

## The other half

Before you start working on a module, ask first: `mcp__cortex__get_project_context_pack` or
`mcp__cortex__ask_project_context` bring the current decisions, constraints and risks. Saving
without reading is half a loop.
