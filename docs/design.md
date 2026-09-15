# Design — the web UI

What the web interface is for, what it deliberately is not, and how to decide whether
something belongs in it. Written after a full pass over the running UI on 2026-09-15.

The rest of Cortex has a clear owner: the MCP tools and the hooks serve agents, the CLI
serves the terminal, `cortex-admin` serves whoever runs the server. The web UI is the piece
whose job has never been written down, which is why it has drifted into being a bit of
everything. This document fixes its job.

## 1. The thesis: agents write, people check

Almost everything in Cortex is written by an agent. A session ends, the transcript is
distilled, entries appear. Nobody types them.

That is the whole reason the UI exists, and it decides its shape. A memory that fills itself
is only worth having if someone can **see what went in and correct it**. Without that, a wrong
entry is worse than no entry: it is a confident, sourced, dated claim that every future
session will read as fact. The context pack does not hedge.

So:

> **The web UI is where a human audits and repairs a memory that was written by machines.**
> It is not a data-entry tool, not a dashboard, and not the primary way anyone uses Cortex.

Three consequences, and they settle most arguments about scope:

- **Reading beats writing.** Every screen should make it easy to judge whether something is
  true, current, and attributable. Capture exists in the UI, but as an escape hatch for the
  person who is not in a terminal — not as the main event.
- **Nothing should be visible without being actionable.** A screen that shows a problem and
  offers no way to fix it teaches people to ignore it. This is the single biggest gap today
  (§5).
- **If a task belongs in a terminal, it stays in the terminal.** Indexing a repo, running
  maintenance, applying migrations: those are `cortex-admin`. Putting them behind a web button
  would mean the web process needs powers it should not have.

## 2. Who opens it

Two people, with different needs, and both matter.

**The developer**, a few times a week, usually arriving from `cortex ui` in a repo they are
working on. They want to know what Cortex believes about *this* project, and to fix the entry
that is wrong. Their context is a project; a screen that forgets which project they were
looking at is failing them.

**Whoever runs the server**, occasionally. Is it working, what is it costing, who has access
to what. They arrive with no project in mind.

The UI currently serves the first badly (the project selection does not survive navigation)
and the second by accident (`/usage` is visible to everyone, unfiltered).

## 3. Constraints that shape it

These are settled and not up for renegotiation without an ADR:

- **Server-rendered, no build step** ([ADR-0042](decisions.md#adr-0042)). Hono + `hono/html`
  with autoescaping. One `graph.js` for the network view is the only client script, and the
  only place a client-side library is acceptable.
- **The web talks to `core` directly**, not to the HTTP API. They are different clients of the
  same domain, not layers. Do not add a `fetch` to `/api/...` from a route handler.
- **Sign-in happens in the terminal.** `cortex auth login` then `cortex ui`, which exchanges a
  single-use ticket for a session cookie. The long-lived CLI token never touches a URL. There
  is deliberately no password or email form in the browser.
- **The brand is configuration.** `getBrandName()` and the optional logo
  ([ADR-0013](decisions.md#adr-0013)). No product name in the markup — and that means *no
  hardcoded "Cortex"* either, which is where the rule is currently broken.
- **Access is one policy.** `checkProjectAccess` ([ADR-0046](decisions.md#adr-0046)); the UI
  never invents its own rule, and "you cannot see it" renders as "not found".

## 4. The screens and the job each one does

| Screen | The job | Belongs here because |
|---|---|---|
| `/` Dashboard | See what the memory holds, filter it, open an entry | The entry point; answers "what does Cortex know?" |
| `/entry/:id` | Judge one entry and act on it | The only screen where a human changes the truth |
| `/search` · `/ask` | Find something by meaning; ask a question of the memory | The same retrieval the agent gets, visible to a person |
| `/pack` | See exactly what an agent receives at session start | Makes the injection auditable — nothing else does |
| `/projects` | See and manage who can reach what | Access is a human decision, not an agent one |
| `/lint` | Find memory that has gone bad: contradictions, gaps, duplicates | Quality control; the reason the whole thing stays trustworthy |
| `/graph` | See the shape of the knowledge and its holes | Spatial questions a list cannot answer |
| `/code` | Search the indexed repository | Adjacent, and cheap to expose |
| `/usage` | What the inference is costing | Operator concern, not a developer one |

**What is not here, and should not be:** creating or deleting projects wholesale, running
maintenance or indexing, editing configuration, administering users or tokens. Those live in
the CLI and in `cortex-admin`, where they belong.

## 5. Known gaps

Honest list, as of 2026-09-15. These are failures against the thesis above, not wishes.

1. **The dashboard shows nothing when it should show everything.** Without a project selected,
   `listEntries` takes the newest 60 across all projects and *then* filters by access in
   memory. On any install where recent entries belong to projects the viewer cannot see — or
   have no project at all — the landing page is empty while hundreds of accessible entries
   exist. Measured locally: 452 accessible entries, 0 shown. The filter has to move into the
   query, before the limit.
2. **Visibility cannot be changed.** Anywhere. Not in the UI, not in the API, not in the CLI,
   not even as a domain function: the only `UPDATE ... visibility` in the repo runs when a
   project is created. A project born public stays public forever. Since `save` auto-creates
   projects as public with no slug and no owner, an install accumulates projects nobody can
   close, adopt, or tidy away.
3. **Member management is invisible in practice.** It appears only when the viewer is an admin
   *and* the project is private. Combined with (2), a deployment where everything was born
   public never shows it at all — which is exactly why it reads as "there is no way to manage
   this". The owner of a private project cannot manage its members either; only the global
   admin can.
4. **`/lint` reports and offers nothing.** Contradictions, duplicates and gaps are listed as
   plain text — not links, no actions — while `core` has the functions to act on them. This is
   the clearest violation of "nothing visible without being actionable".
5. **`/pack` does not link its entries.** You can see what the agent will be told and cannot
   click through to fix any of it. The one screen whose purpose is auditing dead-ends.
6. **Project context does not survive navigation.** Eight header links, none of which carry
   the project you were looking at, and no active-page indicator.
7. **`/usage` shows the whole installation's spend to any signed-in user**, with no project
   filter and no admin check.
8. **Spanish leaks into an English UI**: the dashboard subtitle, the lint section headings,
   the pack section headings, several pills. The rule is in `CLAUDE.md`; the UI breaks it.
9. **Hardcoded product name.** Around forty strings say "Cortex" literally instead of going
   through `getBrandName()` — including "Save to Cortex" sitting directly under a header that
   correctly renders the operator's brand.
10. **The graph checkbox cannot be unchecked.** An unchecked box sends nothing; the handler
    tests for `!== "0"`. The only way to turn entries off is to edit the URL.

## 6. How to decide whether something belongs here

Ask, in order:

1. **Does it help a person decide whether the memory is right?** If yes, it probably belongs.
2. **Is there a human judgement in it that an agent cannot make?** Access, validation,
   resolving a contradiction. If yes, it belongs.
3. **Does it need powers the web process should not have?** Database migrations, model keys,
   filesystem access to a repo. If yes, it is `cortex-admin`.
4. **Would someone reach for the terminal anyway?** If yes, leave it in the CLI and do not
   build a worse second way to do it.
5. **Will it show a problem it cannot solve?** Then either add the action or do not add the
   screen.

## 7. Visual language

Deliberately plain, and it should stay that way: system-ish sans (Inter), monospace for
identifiers and content, a single accent colour, badges carrying the only semantic colour in
the page (type, status, confidence). Density over decoration — these are lists of claims to be
scanned, and the reader is looking for the wrong one.

Two known deficits: no dark mode, and no responsive breakpoints beyond a self-filling grid.
Neither is urgent for a tool opened on a laptop next to an editor, but a phone-sized screen is
currently unusable, and that matters the day someone wants to check a decision in a meeting.
