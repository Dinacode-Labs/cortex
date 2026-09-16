# Design — the web UI

What the web interface is for, what it deliberately is not, and how to decide whether
something belongs in it. Written after a full pass over the running UI on 2026-09-15, and
updated the same day when the rework landed ([ADR-0050](decisions.md#adr-0050)).

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

## 4. The shape: everything hangs off a project

The project is the unit of access, of context packs, and of what a developer has in mind when
they open the UI. So it is the unit of the interface too, and it lives in the URL where it
cannot be lost.

```
[Cortex]   [ Search everything… ]              Projects · Admin* · you · Sign out

/                       the projects you can reach — entries, visibility, health
/p/<slug>               Memory           what is remembered, filtered, plus "Add"
/p/<slug>/ask           Ask
/p/<slug>/agents        What agents see  the pack, with every entry linked
/p/<slug>/health        Health           contradictions, gaps, duplicates — each one linked
/p/<slug>/map           Map
/p/<slug>/code          Code
/p/<slug>/settings      Settings         visibility, owner, members (managers only)

/entry/<id>             read, edit, and say whether it still holds
/search?q=              across everything you can see
/admin/usage            what the inference costs (admins only)
```

Labels are written for the person reading them, not for the internals: **Health**, not "Lint";
**What agents see**, not "Context pack". Old URLs redirect permanently — a link someone pasted
in a chat three weeks ago still works.

Two things stay above the project, because they genuinely are: **search**, which is the only
question that crosses projects, and the **admin** area, which is about the installation rather
than about any project in it.

**What is not here, and should not be:** creating projects wholesale, running
maintenance or indexing, editing configuration, administering users or tokens. Those live in
the CLI and in `cortex-admin`, where they belong.

## 5. Known gaps

The list this document opened with had ten entries. Nine are closed; what follows is what is
still true, plus what the rework did not touch.

**Still open:**

1. **`/health` links but does not act.** Every finding now opens the entries behind it, which
   was the worst of it — but merging a duplicate or resolving a contradiction still means
   editing each entry by hand. `core` has `planLintActions` and `saveWithReconciliation`; the
   screen does not use them yet.
2. **No entity pages.** Entities appear as tags that run a search. `resolveEntity`, `relate`
   and the graph all know more than the UI shows.
3. **No pagination anywhere.** Fixed limits (60 entries, 15 results, 10 code hits) with no
   indication that there is more.
4. **No dark mode.** The palette is light-only. The layout is responsive as of the rework, so
   a phone works; a dark room does not.
5. **Editing has no history.** A correction overwrites, leaving only `updated_at`. For a system
   whose whole argument is traceability, that is a gap worth closing when someone needs it.

**Closed on 2026-09-15:** the empty landing page ([0052](decisions.md#adr-0052)); visibility
and owner being unchangeable and member management being invisible
([0051](decisions.md#adr-0051)); the pack not linking its entries; project context being lost
on navigation; `/usage` being visible to everyone; Spanish in an English UI; the hardcoded
product name; the graph checkbox that could not be unchecked; and entries that could be judged
but not corrected.

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

Deliberately plain, and it should stay that way: Inter, monospace for identifiers and content,
**one** accent colour, and badges carrying the only semantic colour on the page (type, status,
confidence). Density over decoration — these are lists of claims to be scanned, and the reader
is looking for the wrong one.

It is a design system in one stylesheet, no framework ([ADR-0053](decisions.md#adr-0053)). The
tokens at the top are the contract: one accent, a five-step ink ramp, spacing in multiples of
four, six type sizes. **A hardcoded value is an inconsistency six months from now** — if a
number is not in the scale, the scale is wrong or the design is.

Components live in `views/components.ts` and the routes compose them. A route writing its own
`<div class="panel">` is how the same idea ends up looking different on four screens, which is
exactly what this replaced.

Two tests hold the line: every class a page emits must have a rule behind it, and the
stylesheet's braces must balance. And the stylesheet URL carries the release version, because
without it a browser keeps the old copy and a deployed redesign simply does not arrive.

One known deficit: no dark mode. Now a matter of redefining tokens under a media query rather
than a rewrite.
