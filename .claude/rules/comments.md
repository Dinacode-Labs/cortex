# Comments

The code explains itself; a comment explains only what the code cannot. Clean Code's rule holds
here: **a comment is an admission that the code failed to say it**. Before you write one, try the
cheaper fix — a better name, a smaller function, a named constant, an extracted predicate.

That is not licence to leave the reader guessing. It is an order of preference: make the code say
it, and when it genuinely cannot, say the **why** in one or two lines.

## Never write

- **What the code does.** `// increment the counter`, `/** Returns the user's name. */`. The
  identifiers already say it; when they do not, rename them — that is the fix.
- **A restatement of the signature.** A JSDoc block repeating the parameter names and their types
  is noise the compiler already checks.
- **Narration of the obvious next line**, section banners, commented-out code, or a changelog in
  the margin. Git holds the history.
- **The current task, ticket or PR.** Meaningless to whoever opens the file next year.

## Write only for a why that is not obvious

A hidden constraint, a workaround and the bug it exists for, a subtle invariant, a decision
recorded in an ADR, a behaviour that would surprise the reader. Say **what happened**, not what the
line does: "222 nodes named after a whole sentence" teaches something; "extracts the entities"
does not.

Keep it to a line or two. A comment nobody finishes is a comment nobody applies, and the longer it
is the sooner it drifts from the code beneath it. If the why needs a paragraph, it is an ADR in
`docs/decisions.md` and the code cites the number.

## Rather than a comment

| You were about to write | Write this instead |
| --- | --- |
| `// check that the user can do this` | a `canEdit(user, project)` function |
| `// 8000 is the session budget` | a named constant |
| `// this branch is the slow path` | a name that says so |
| how a module fits together | a line in `docs/`, cited from the code |

## When you touch a file

Delete the comments that only restate the code you are reading, in the file you are already
editing. Do not sweep files you are not touching: that is a change of its own (see
`documentation.md`).
