---
description: Summarise this session and save it to Cortex, the project memory
argument-hint: "[project]"
---

Save to the project memory what this session decided, fixed or discovered, with
`mcp__cortex__save_project_context`. One entry per fact.

Project: $ARGUMENTS. If that is empty, work it out from the current repository or folder, and ask
only if it is genuinely ambiguous.

Follow the `cortex-capture` skill: its **Format** section for `title` and `content` (What / Why /
Where / Learned), its **Do NOT save** section for what to leave out, and `sourceType:
"claude_code"`. If Cortex flags a duplicate or a contradiction, say so instead of saving another
copy.
