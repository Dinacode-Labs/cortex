---
description: Summarise this session and save it to Cortex, the project memory
argument-hint: "[project]"
---

Summarise the work done in this session and save it to the project memory with the
`mcp__cortex__save_project_context` tool.

Project: $ARGUMENTS. If that is empty, work it out from the current repository or folder, and
ask only if it is genuinely ambiguous.

Follow the `cortex-capture` skill: a structured summary (summary, decisions, files, risks,
open items, sources) with `sourceType: "claude_code"`. If Cortex flags a duplicate or a
contradiction, say so instead of saving another copy.
