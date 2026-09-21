# Changelog

Notable changes to Cortex. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning [SemVer](https://semver.org/).

While we are on `0.x`, a **minor** release may bring breaking changes and a **patch** only
fixes things.

## [Unreleased]

### Added
- **The distiller can be measured.** `cortex-admin eval-distill` runs the session distiller over
  a fixed set of eight transcript windows (`evals/distill/`) with an annotated expectation
  each, and reports expected recall, forbidden leaks, mistyped items, items per window and
  windows with nothing in them; `--verbose` prints every item it emitted, and
  `--windows` / `--gold` point it at another set. Half of the windows expect **nothing** —
  narration, an open discussion, a hiccup local to the session, acknowledgements — because
  recall is cheap to buy by keeping everything. It needs an LLM and refuses to run without one:
  the distiller *is* the model, so with no model every window comes back empty and the table
  would read as a perfect zero. What each window tests and what the numbers mean:
  `evals/README.md`.

  The eight cases exist **in English and in Spanish**, one directory per language
  (`distill/en/`, `distill/es/`), run separately and each with its own mark: mixed into one
  total, a gain in one language would hide a loss in the other. English is what `eval-distill`
  runs with no arguments and `--lang es` gets the other. Since the agents answer in Spanish
  whatever they are fed (`OUTPUT_LANGUAGE`), the English set measures whether the judgement
  survives a session that is not in the language of the corpus, and it is annotated only with
  keywords that survive translation.

### Changed
- **The eval sets moved out of `tests/` and into `evals/`.** An eval is not a test: it marks a
  model, so it needs a real provider, costs money and is launched by hand, while everything
  under `tests/` runs on every commit and has to pass. The corpus and the questions are now in
  `evals/retrieval/`, the distillation windows in `evals/distill/<language>/`, and what the sets
  contain and what their baselines are is in `evals/README.md`. Both commands are run exactly
  as before, `--questions` / `--windows` / `--gold` still take a path of your own, and what
  guards the sets stays in `tests/`, where CI runs it.
- **Retrieval is marked by a function, not by the command.** recall@k and MRR came out of the
  middle of `eval`, where they could not be exercised without a Postgres and a real provider;
  they are now `apps/admin/src/eval/retrieval-score.ts`, beside the distiller's marker, and the
  table the command prints is the same one. What the numbers mean is tested with no database —
  that one piece of evidence out of three is a third and not a hit, that MRR follows the first
  one, that nothing past `--k` counts, and that the questions the corpus does not answer stay
  out of the averages — and so is the set itself: evidence citing an id nobody wrote used to be
  reported for ever as a miss and blamed on the search.
- **`commands/` holds commands and nothing else**, in both CLIs: what a command needs and is not
  one itself lives in a sibling directory. A module parked in there reads as a subcommand that
  cannot be invoked, and a command that never reaches the dispatcher exists without being
  reachable; `tests/cli-commands.test.ts` now checks both.
- **What a command is, written down.** `.claude/rules/cli.md` now answers without opening any
  code what a command is and why it is a layer of its own, what goes in its file (`run(args)`,
  its own flag parsing, its own usage line) and what does not (library code, side effects at
  import time, `process.exit`), how it reaches its dispatcher and why loading is lazy and by a
  literal path, what `managed: false` takes over, and where whatever is not a command belongs.
- **How to build an eval is written down**, in `.claude/rules/evals.md`: when a mark on a model
  replaces an assertion, how the marking key is written, why half the exam has to expect nothing,
  and why a set with no first run is worth nothing. The rules of thumb that are easy to get wrong
  in silence are tests now, not paragraphs (`tests/eval-distill-fixture.test.ts`).

## [0.1.12] — 2026-09-18

### Added
- **Cortex has a mark.** "Relay": two pieces that change places and a centre that stays —
  sessions change, knowledge stays. One 8×8 drawing renders the web header (with a one-shot
  animation on sign-in and home), the favicon (`/favicon.svg`) and a splash in the CLI (`cortex`
  with no arguments and `cortex version`, on an interactive terminal only; never in CI, in hooks
  or in `cortex mcp`, and off under `NO_COLOR`). Operators with their own `CORTEX_BRAND_NAME` or
  logo see theirs and no Cortex mark. What it means and how it is built: `docs/brand/README.md`.

### Changed
- **The repository is in English, all of it.** Half of it already was — the README, the CLI, the
  MCP tools, the web UI — and the other half, deliberately, was not: code comments, the ADRs,
  the roadmap, the research notes, test names and the agents' prompts were the team's working
  record and stayed in Spanish. In a public repository that is a repo half of which nobody
  outside can read, and the half they cannot read is the one that explains *why* things are the
  way they are: a comment that saves someone an hour is worth nothing to a reader who cannot
  parse it. Roughly 2,800 lines of comments, 460 test names, the 14 documents under `docs/`, the
  CHANGELOG, the deployment files and the CI workflows were translated.

  Two things stay in Spanish on purpose, and both are **data rather than prose we wrote**: the
  patterns that match the corpus — the classification rules in `packages/core/src/text.ts`, the
  deictics in `domain.ts` and the eval fixtures, against which the recall@5 0.987 / MRR 0.928
  baseline was measured — and the **output language** of the LLM agents (`OUTPUT_LANGUAGE` in
  `packages/agents/src/mastra.ts`), whose prompts are now English but whose output is stored
  next to a corpus that is already Spanish. Values owned by an external system keep their own
  spelling too (Plane's `'Histórico'`, Notion's property names, the migration filenames, which
  are primary keys in `schema_migrations`). Each carries an English comment saying why.

  Being Spanish speakers, the two entry points are also kept in Spanish, `README.es.md` and
  `CONTRIBUTING.es.md`, with English as the version that must be current when they disagree.
  ADR-0064.

- **The rules this repo is worked by can now be read, and cited** (ADR-0065). `CLAUDE.md` was the
  only thing written for an agent, it had reached 11.6 KB, and it still left out most of what has
  to be got right: how a route, a command or a screen is written here, when to throw and when to
  return, what a comment is for. That now lives in `.claude/rules/`, one file per subject. Four
  load always, because they hold for any change — architecture, language, tests and documentation
  — and five carry a `paths:` header and only show up when you touch what they cover: TypeScript
  style, the HTTP API and MCP, the CLI, the web and the LLM layer. `CLAUDE.md` comes down to under
  7 KB and keeps what only it can say. What covers one corner of the tree no longer costs context
  until you open that corner, so the detail can be written where it used to be too expensive.

  Two conventions the repo had been following without stating them are settled along the way:
  there is no formatter and no linter, and the style is written down instead; and `any` is only
  valid at a boundary with a foreign format that has no schema, never crossing into the domain.
  And a test watches the rules themselves, as with the CLI's weight or the configuration template:
  it fails if a rule is imported twice into context, or if a `paths:` header points at a directory
  that no longer exists.

### Fixed
- **`/context-pack` answered 500 instead of 404 for a project that does not exist.** The route
  matched the error by the text of a message defined in `packages/core`, and the two had drifted
  apart. Found while translating.

## [0.1.11] — 2026-09-17

### Added
- **"Across this client": a parent project can now be read, not just opened.** Inheritance goes
  UP — a repo sees its client's knowledge, never a sibling's — and that leaves unanswered
  exactly the question a parent project exists for: what its repos share and where one decided
  the opposite of another. A project with children now has one more section, with three things:
  the **shared stack** (`technology`/`module`/`service`/`integration`/`vendor` entities linked
  from current entries in two or more children, and which ones; `client`, `project` and
  `repository` are left out, being extractor noise today), **contradictions across projects**
  (the `contradicts` relations whose two ends sit in different projects of the subtree — the
  lint is per project, so a clash between siblings showed up in neither one's report) and
  **searching downwards**: an "include child projects" checkbox that only appears on the parent,
  off by default, which says which repo each result comes from. Everything that crosses
  downwards filters by permissions before looking at anything. ADR-0063.
- **The CLI says when it is falling behind, and refuses to write when it falls too far behind**
  (ADR-0062). Everyone updates the CLI themselves from npm and an operator updates the server:
  two different clocks, and it showed this week, with three deployments in a row and people
  going days on an old CLI without noticing. The warning existed in `cortex doctor`, where
  nobody looks. Now:
  - Interactive commands query `/client-config` **once every 24 h** per server (cached in
    `~/.cortex/version-check.json`) and, when there is a newer version, drop **one line to
    stderr** on exit: `Cortex 0.1.9 → 0.1.12 · cortex upgrade`. Only with a terminal attached;
    in a script, in CI or in a pipe they say nothing. The hooks and `cortex mcp` **never go
    through it** (stdout is protocol), and there is a test that guarantees it.
  - If the CLI is **below `minClientVersion`**, the commands that write (`mem save`,
    `mem update`, `link --create`, `connect-*`) fail with a clear message instead of storing
    something half-formed. The reading ones keep working. It is the only number that blocks, and
    the operator raises it when something genuinely breaks (`CORTEX_MIN_CLIENT_VERSION`).
  - The opposite case, which was invisible: if the **CLI is newer than the server**, it says so
    and tells you to warn whoever operates it. That is the one that will happen to us: npm moves
    faster than a deployment.
  - `CORTEX_NO_VERSION_CHECK=1` turns all three off. Version comparison lives in one place and
    already tolerates `v` prefixes and prereleases; `doctor` and `version` reuse it.
- **A written rule for whoever adds an endpoint**: the CLI treats what it does not know as "that
  feature is not there", not as an error. A missing field or a 404 on a new endpoint is an old
  server and it degrades. It was already happening in several places; now it is stated in the
  ADR, in `CONTRIBUTING.md` and in the HTTP client's header.
- **The project hierarchy can be seen, not merely exist.** A client with several repos is a
  parent project with one child per repo (ADR-0037, ADR-0056), and context pack inheritance and
  permissions hang off that — but in the web it showed up on no screen at all. Now a project's
  header carries a **breadcrumb up to the root** (`Acme › Acme Portal`, every level linked), a
  parent lists **its repos** with the same cards as the home page, the **home page groups**
  children under their parent instead of laying them out as siblings, and **What agents see**
  marks each inherited entry with the project it comes from, which used to be silently mixed in.
  What crosses downwards filters by permissions: a private child you are not a member of does
  not appear just because you can see the parent.

### Changed
- **This repository stops versioning its `.cortex.json`.** Being public, a committed link turns
  *our* project into the one every clone in the world brings by default, and forces contributors
  to edit a versioned file to use their own. The general rule, which is what somebody adopting
  Cortex needs to know: **version it in a private organisation repo; ignore it in a public one.**
  See ADR-0059.
- **`.env.example` is a template again, not a document.** It had 336 lines of which **155 were
  prose**: explanations of why something was decided, what it used to be called and what gets
  retired in which version. That is ADR and CHANGELOG material, not material for a file you copy
  to `.env`. It is now 167 lines, one per variable with what it does and its default, and the
  deprecated names (`NAN_*`, `BREVO_SENDER*`) are no longer offered — they still work, with
  their warning, but a template is what you should be writing today.

### Fixed
- **A project's map paints again.** `/p/<slug>/map` stayed black on any deployment: it asked
  for its data at `/api/graph`, and that whole prefix is taken by the API server, which does not
  have that route. The endpoint moves to `/graph.json`. While there, the "Include entries"
  checkbox could not be ticked again — the form sends two values and the first one was being
  read — and with no entries the graph has not a single edge to paint.
- **The classifier no longer manufactures projects.** It offered `project` among the entity
  types, so any proper noun the LLM took for a project — tickets, branches, files,
  microservices — ended up in `entities` with `type='project'`: the same row as a real project,
  but with no slug and no owner, and it showed up in `cortex link` and in the UI mixed in with
  the real ones (in a real installation, 26 ghosts against 10 projects). Now a project is
  **created, not extracted**: `project` remains an entity type — it is the project's row — but
  it is not offered to any extractor, `core` discards whatever arrives with that type, and the
  database demands a slug from every `project`. Migration `0019` deletes the ghosts (only the
  ones with nothing hanging off them; no entry is touched) and adds the CHECK. ADR-0060. (#135)
- **The project slug works for reading, not just for writing.** The slug is the project's
  identity across the whole product (`cortex link`, `.cortex.json`, `/p/<slug>`, the API), but
  in the MCP tools `project` resolved by canonical name when reading and by slug when writing,
  and since normalisation leaves hyphens alone, `save_project_context` with `acme-portal` stored
  into Acme Portal and `get_project_context_pack` with that same value said "Project not found".
  There is now **one single** resolution for everything (slug first, canonical name after),
  which the permissions guard uses too — it also compared the exact name, so it rejected what
  the data operations did find — and the pack carries the project's real name. ADR-0061. (#136)
- **`search` and `ask` inside a child project now look at the parent's knowledge too.** The
  context pack inherited from its ancestors and search did not, so a client's cross-cutting
  knowledge — contracts, conventions, who to talk to — was stored once in the parent project and
  **could not be found from the child's repo**, which is exactly where it is needed. Going up is
  safe: access to the child already requires access to the whole chain, so inheritance exposes
  nothing that could not be seen directly. And it does not go down: from the parent you do not
  see a child's knowledge.
- **"You are not signed in" was a lie most of the time.** When the MCP could not authenticate it
  said that and sent you to repeat a `cortex auth login` you had already done. The real case is
  another one: the folder points — through its `.cortex.json` or through `CORTEX_SERVER_URL` —
  at a server there are no credentials for, while there are credentials for another. The message
  now says **which server** it looked for, which folder it resolved that from, and **which
  sessions do exist**. An error that misdirects costs more than one that stays quiet, because it
  looks like it knows.
- Seven environment variables the code reads that appeared in no template
  (`CORTEX_BIND_HOST`, `CORTEX_ENV_FILE`, `CORTEX_NPM_PACKAGE`, `CORTEX_OPENCODE_DB`,
  `CORTEX_PI_DIR`, `CORTEX_SEARCH_TYPE_BOOST`, `CORTEX_WORKER_HEARTBEAT_FILE`). They existed,
  they worked and nobody knew about them. There is a test that compares the two lists.

## [0.1.10] — 2026-09-16

### Added
- **`cortex connect-docs` is now in the CLI.** Ingesting a documentation folder used to require
  cloning the whole monorepo, because the connector lived only in `cortex-admin`, which is not
  published to npm — and it is one of the first things anyone wants to do. The CLI now reads
  Markdown and plain text, which is most of any team's documentation and everything Notion
  exports. What needs heavy dependencies (docx, pdf, xlsx, images, audio, video) is **not
  silently ignored**: it is counted by type and the command that handles it is named. See
  ADR-0058.

## [0.1.9] — 2026-09-16

### Added
- **An empty project can be deleted.** There was no way to delete a project in any interface, so
  a `cortex link --create` with a misspelled name was permanent: it could not be renamed, nor
  recreated — the slug was taken — nor removed. On a shared server that piles up ghost projects
  in everybody's list. Now its owner or an admin can delete it **if it has neither entries nor
  children**; with memory inside it answers 409 and nothing is touched. The line is drawn at the
  memory, not at permissions: invalidating is not deleting, and that cannot be one click away.
  See ADR-0057.

### Added
- **A project can be hung off a parent after it has been created.** The parent was only set at
  creation time, so whoever linked a repository in a hurry created a loose project with no way
  back: it could not be re-attached nor recreated, because the slug was already taken. For a
  client with several repos that are not a monorepo, that split its memory forever over a
  missing flag. It is now in `PATCH /projects/:slug` and in Settings, next to visibility and
  owner. Cycles are rejected: permissions and the pack walk up the ancestor chain, and a cycle
  would not be a wrong answer, it would be an infinite loop. See ADR-0056.

## [0.1.8] — 2026-09-16

### Fixed
- **The repeated title is stripped from summaries that were already stored, too.** The 0.1.7 fix
  acted when saving, so the existing memory — where nearly all the entries are — kept spending a
  quarter of each line of the pack repeating its own title. Migration `0018`, with the same rule
  as the code: it is only removed when the summary really does start with the title and what is
  left is a summary worth having.

## [0.1.7] — 2026-09-16

### Added
- **Reviewing the memory stops being invisible.** The health report says how many current
  entries a person has never confirmed or corrected — in a real project it was **348 out of
  348** — and links straight to that list. The Memory section gains a status filter, which is
  what turns "348 unreviewed" into somewhere to start. As long as nobody validates, status and
  confidence distinguish nothing and the pack cannot prioritise by reliability even though it
  knows how.

### Fixed
- **The health report was half full of noise, and the noise came from the graph.**
  `entities.type` accepted `decision` and `incident`, which are **entry** types, so the same
  decision was stored twice: once as an entry and once as a graph node with the whole sentence
  for a name. In a real installation, **222 nodes like that**, and the 18 contradictions
  detected were all between nodes and none between entries, with pairs as useless as "option C
  ⟷ option A". An entity is a **thing that gets named** again: the two types leave the enum,
  names are filtered by shape (no sentences, no deictics) and a migration cleans up the ones
  that were there. No entry is touched. See ADR-0055.

### Fixed
- **A long session always lost its ending, and nobody noticed.** Distillation slices the session
  into windows and keeps eight of them; on hitting the cap it cut off, so out of a 128,000
  character session the first 72,000 were distilled and the rest thrown away — and in a working
  session the conclusions are at the end. The capture also finished as `done` with its counters,
  identical to one that had fitted. Now, when it does not fit whole, the windows are spread
  across the entire session (first and last always included) and the capture records how many
  characters were left out.

### Fixed
- **Half the memory never reached an agent.** The context pack rendered five of the fourteen
  entry types, because they were five hand-written fields in one interface. Measured over a real
  project of 349 entries: **172 of 348 current ones (51%)** were of types the pack did not
  paint — among them 38 incidents, while the same project's health report warned about
  "incidents with no decision". Now everything that describes the project's **state** gets in:
  architecture, business rules, incidents, integrations, module notes and how-tos, on top of the
  five from before. The three that are a record of an event (meeting, PR, ticket) stay out on
  purpose, and a test forces that to remain a decision. See ADR-0054.
- **Every entry in the pack spent 23% repeating its own title.** The summary is taken from the
  first characters of the content, which starts with the title, so **355 of 355** summaries in
  that project began by repeating it. It is stripped on save.

### Changed
- The session context budget goes from 6,000 to **8,000 characters**: it was sized for a pack
  that covered a third of the memory. With the full pack, 8,000 is the point at which all eleven
  sections carry content — 25 entries instead of 13.
- The pack's sections are now **weighted**: what governs today's work (decisions, constraints,
  architecture) counts double what merely accompanies it.

## [0.1.6] — 2026-09-15

### Fixed
- **A deployed redesign could never reach the browser.** `/styles.css` was served with no
  `Cache-Control` and no `ETag` — only `Last-Modified` — so the browser kept the previous copy
  without asking: anyone who had been in before saw the new HTML with the old styles, half
  painted, which is indistinguishable from a broken deployment. The stylesheet now carries the
  version pinned to its URL.

### Changed
- **A full visual pass.** A coherent scale (one accent, five shades of ink, spacing in multiples
  of four, six text sizes) and a real component layer in `views/components.ts` that the screens
  **compose** instead of writing loose HTML — the same idea used to come out differently in
  every place. No CSS framework: what was missing was a scale, not a tool. See ADR-0053.
- A brand mark of our own instead of the word with its first letter in blue.

## [0.1.5] — 2026-09-15

### Changed
- **The web UI now revolves around the project.** It was eight flat links and every screen had
  its own selector, so moving from one section to another sent you back to the first project in
  the list. Now the home page is your projects and each one has its own address — `/p/<slug>` —
  with its sections hanging off it: Memory, Ask, **What agents see**, **Health**, Map, Code and
  Settings. The labels are written for whoever reads them, not for the system's insides. Every
  old address redirects. See ADR-0050.
- **What agents see and the health report now link out.** The context pack and every
  contradiction, gap or duplicate lead to the entries involved: showing a problem with no way to
  open it teaches people to ignore the warnings.
- **Entries can be corrected**, not only validated or rejected. Since an agent writes nearly all
  of it, being able to say "this is wrong" without being able to fix it left the memory with no
  way to improve.
- **AI cost moves to `/admin/usage` and only admins see it.** What the installation spends on
  inference is no business of every developer who drops in to review a decision.
- The UI is **in English** in what used to be generated on the fly too, and the product's name
  comes from `CORTEX_BRAND_NAME` in the buttons as well, not only in the header.
- The interface **works on a phone**.

### Fixed
- The knowledge map's checkbox could not be unticked from the interface.

### Added
- **A project can now be managed after it is created.** Until now visibility was set at creation
  time and there was no way to change it in any interface — no UI, no API, no CLI, not even a
  domain function — so a project born public was public forever. Now its **owner** (not just a
  global admin) can make it private or public, hand over ownership and manage members, from
  `PATCH /projects/:slug` and `POST`/`DELETE /projects/:slug/members`. See ADR-0051.
- **Every project has a slug.** A migration fills in the ones that were missing, and the
  projects a `save` creates go down the same path as `cortex link --create`: with a slug and
  with an owner. They used to be born with neither, impossible to link, to adopt or to close.

### Fixed
- **The UI's home page came up empty with hundreds of visible entries.** The 60 most recent
  entries across all projects were requested and then, in memory, the ones from projects with no
  access were discarded: it was enough for those 60 to belong to other people — or to have no
  project — for the product's first screen to show up blank. Measured against real data: 452
  accessible entries, 0 shown. The access filter moves inside the query, before ordering and
  limiting. See ADR-0052.

## [0.1.4] — 2026-09-15

### Fixed
- **Only the project's decisions reached the agent.** The context pack injected when a session
  opens was trimmed with a cut at the end, so in a large project — measured in a real one: 28,389
  characters — the 6,000 cap ate everything but part of the first section. Constraints, risks,
  technical debt and conventions **never arrived**, and nothing said so: an absent section reads
  as "there is none of that here". The server now does the trimming by splitting the budget
  across sections, each one says how many entries it left out, and the order inside each section
  goes by confidence rather than by creation date (which after a backfill orders nothing). See
  ADR-0049.

## [0.1.3] — 2026-09-15

### Fixed
- **`cortex ui` opened the browser at `localhost`.** It authenticated correctly against your
  server, asked for the single-use ticket, said "Opening the Cortex UI, already signed in"… and
  opened an address that does not exist. It is one of the most baffling failures there is,
  because the whole flow looks fine. The cause: the web's address came from a variable with a
  development default, and not from what the server itself publishes at `/client-config` — which
  exists for exactly this. The server is in charge now; `CORTEX_WEB_URL` can still force it and
  `localhost` is left as a last resort.

## [0.1.2] — 2026-09-15

### Fixed
- **`cortex auth login` went to the wrong server.** With a session already configured, running
  it without `--server` tried to authenticate against the default development server rather than
  yours — the only CLI command that did not respect what was already there. Now the commands
  that do not work inside a repository (`auth login`, `auth logout`, `ui`) follow one single
  rule: what you ask for by hand wins, then the environment, then whichever single session
  exists, and **with several it asks** instead of guessing. With nobody there — a script — it
  does not guess either: it says which ones exist and stops. The commands that do work in a
  repository keep taking it from the `.cortex.json` and never ask (ADR-0033).
- **Two connectors wrote to the wrong server.** `connect-sessions` and `connect-github` did not
  resolve the server from the folder, so with several Cortex instances configured they sent the
  knowledge to the default one. That is exactly what ADR-0033 exists to prevent.

### Changed
- **`cortex connect-sessions` no longer asks for what the folder already knows.** Run inside a
  linked repository it needs neither a slug nor a path: it takes them from the `.cortex.json`
  and from the directory. Asking for both was redundant and invited typing another project's
  slug. The explicit form still works for backfilling a different folder.

### Added
- **`GET /metrics` in Prometheus format** (ADR-0048), to find out what a health check does not
  see: the maintenance worker dying — it has no port, and it is what keeps the memory alive — or
  captures starting to fail while the service keeps answering quite happily. Standard format
  rather than a dashboard of our own: other people deploy this, they already have their own way
  of watching, and a dashboard has to be looked at. Off unless `CORTEX_METRICS_TOKEN` is
  defined; with no token it answers 404 rather than 403, so as not to announce what is there.
- The worker also beats in the database, not only to a file inside its container, which was why
  its death was invisible from outside.

## [0.1.1] — 2026-09-14

### Fixed
- **Long sessions were lost whole.** The server rejects anything over 150,000 characters with a
  413, and a working session with an agent goes well past that — measured, 154,035 in a single
  one. Long sessions are precisely the ones carrying the most knowledge, so the effect was
  losing the entire day's work. The client now trims before sending, and it does it **from the
  beginning**: a session ends in conclusions and starts in groping around, so if something has
  to be lost, let it be the groping. A marker is left so distillation does not read the cut as
  the start of the conversation.
- **`cortex doctor` raised a false alarm with several servers.** Any one of them being down
  produced "1 problem stopping Cortex from working" even if the one that folder uses was
  perfectly fine. It now only blocks on the server the folder actually uses — the one in
  `.cortex.json`, or the default; the rest is a warning, with the exact command to close that
  session if it is no longer needed. The first time somebody sees an alarm that is not true,
  they stop trusting the whole diagnosis.

### Changed
- **The decision log, revised top to bottom and in English.** It had twelve decisions **with no
  number**, hidden inside another one behind loose headings: two of them were already being
  cited by title because there was no number to point at. They are now ADR-0036 to ADR-0047,
  with their real date taken from the history. Seventeen were still marked "accepted (demo)" in
  a system deployed and in use. The ordering broke from 0024 onwards. And the new index tells
  the thread in phases — foundation, multi-user, architecture cleanup, accepted limits, product,
  real use — which is what was needed to see where this was going and why. The numbers do not
  change: 67 files cite them.

### Added
- **A per-IP limit on sending access codes.** There was already a per-email-address limit, which
  stops somebody being hammered; what it did not stop was asking for codes for many different
  addresses from a single IP, because each one got its own fresh budget. With email sending
  switched on those are real messages to real people, and a bill. Adjustable with
  `CORTEX_AUTH_IP_MAX` and `CORTEX_AUTH_IP_WINDOW_MIN`.

### Fixed
- **The installer says why it failed, instead of always blaming permissions.** It silenced
  `npm`'s output and, whatever happened, sent you off to reconfigure the npm prefix. If the
  package did not exist, if the registry did not answer or if there was a proxy in the way, the
  person went to fiddle with their configuration for nothing — and that is the first impression
  they get of Cortex. It now tells a 404, permissions and the network apart, and when it is none
  of the three it shows what npm said instead of inventing a cause.

### Changed
- **Search infers the type when the question names it.** "What technical debt is there around
  billing?" retrieved neither of the two correct entries: all five results were about billing and
  none was technical debt, because "technical debt" contributes far less to the embedding than
  "billing". That type is now nudged upwards, **without filtering** — filtering would lose the
  answer when it is stored under a different type. recall@5 0.961 → 0.987 and MRR 0.901 → 0.928
  on the eval, without moving the questions that already worked. The size of the nudge was
  chosen from the eval's curve (`CORTEX_SEARCH_TYPE_BOOST`, 0.15).

### Added
- **`cortex-admin eval`: retrieval is measured now.** 40 questions with annotated evidence
  against a fixed corpus that ships in the repo (`tests/fixtures/eval/`), with recall@5 and MRR
  broken down by kind of question — direct, paraphrased, split across several entries,
  reasoned — plus two questions whose answer is not there, to see whether the memory pretends to
  know what it does not. `--verbose` shows what came out when something fails, which is what
  tells you where to fix it. The corpus does not come from the real memory on purpose: an eval
  exists to compare runs, and the real memory changes every day.

## [0.1.0] — 2026-09-12

The first publishable release. Cortex stops being a repo you clone and becomes a server you
deploy and a CLI you install: `npm i -g @dinacodelabs/cortex`, `cortex auth login`,
`cortex setup --all`, and that laptop's agents already read from and write to the project's
memory, with no model keys and no local database.

### This release's changes, in reverse order of arrival

### Added
- **The context pack flags decisions that contradict each other** (ADR-0035). When two current
  entries clash, the pack still hands over both — which one is redundant cannot be judged
  automatically without risking deleting the good one — but it now says so **next to each of
  them**, and which was recorded first when that is known. Between entries the pair is named;
  when the contradiction is between graph entities — the frequent case — it only says that area
  is disputed, because asserting a specific pair there would be a lie. The pack used to hand
  them over as if nothing were wrong and the agent decided blind, and two different agents
  spotted it on their own and warned about it without being asked.
- **The memory, as agent tools in Pi** (ADR-0034). Cortex registers `cortex.mem_save`,
  `cortex.mem_search`, `cortex.mem_get_observation` and `cortex.mem_update`, which is what
  gentle-pi looks for to offer Cortex as the store for its working cycle. The prefix is not
  decorative: Pi keeps the first extension that registers a name and does it **silently**, so a
  bare `mem_save` would have left the tools of anyone with another memory installed
  unreachable. With the prefix they coexist, and gentle-pi recognises them just the same.
- **The API can read now.** It only wrote before: searching existed through MCP only, against
  the database, so neither the CLI nor any non-MCP integration could query the memory. There is
  now `GET /search` (with no `slug`, scoped to what you can see; with `slug`, to that project),
  `GET /entries/:id` and `PATCH /entries/:id` to correct a title and content.
- **`cortex mem`**: save, search, read and correct from the terminal, with `--json` for whoever
  calls it from code. It is also the bridge Pi's tools use, so that resolving the server and the
  token keeps living in one single place.

### Changed
- **The npm package is renamed `@dinacodelabs/cortex`.** The `@dinacode` scope is already taken
  on npm by an unrelated organisation, so the name the repo declared could not be published: the
  release would have failed with a 403 even with a correct token. The name changes everywhere —
  installer, plugin, workflows, `cortex upgrade` and docs; the command to install it becomes
  `npm i -g @dinacodelabs/cortex`. `CORTEX_NPM_PACKAGE` still works for pointing at another
  package. Since `0.1.0` never actually got published, there is nothing to redirect and nobody
  to warn.

### Fixed
- **The memory stopped filling up with echoes of itself.** When an agent saves a decision with
  the tool and, on closing the session, distillation saves it again in different words, the two
  entries arrive with different `sourceType` (`manual` and `agent_session`). The reconciliation
  branches require the same origin — so as not to rewrite curated knowledge — and the "I already
  know this" threshold sits at 0.95, so the pair went straight down the middle: measured on a
  project with several agents, that echo scores **0.86–0.88**. Now, between different origins
  and above the threshold, the reconciler is asked **only in order not to write**: nothing is
  ever modified or invalidated, and the worst that can happen is that something we already knew
  does not get added.
- **The lint sees those duplicates now.** The bar was 0.88 for everything; it now drops to 0.85
  between entries of the **same type**, which is where the echo falls, and stays put across
  different types, where looking very alike is legitimate (the incident that prompted a decision
  looks like the decision, and neither is redundant).
- **OpenCode capture stored nothing, silently.** OpenCode moved its sessions from JSON files
  (`storage/{session,message,part}`) to a SQLite database (`opencode.db`). The reader kept
  looking for the old layout, found nothing, and the hook, which is quiet by design, exited with
  0. It looked configured and stored not a single session. It now reads the database and, when
  that is not there, the file store: a laptop with an older OpenCode keeps working.
- **The bundled CLI lost `node:sqlite`, and with it OpenCode and Hermes capture.** esbuild
  rewrote `import("node:sqlite")` as `import("sqlite")` when bundling. That module does not
  exist, the import threw and the `catch` returned empty. It worked from the sources and did not
  work installed from npm, which is the worst way for something to be broken. There is a test
  that now looks at the bundle itself.
- A badly formed entry id reached Postgres and came back as a 500. It is user input: it now
  answers the same as an id that does not exist.
- **Pi receives context and captures on close now.** The hooks hung reading `stdin`: Claude Code
  writes its JSON and **closes** the pipe, but Pi calls the CLI with `execFile`, which leaves it
  open and mute. The `for await` over `process.stdin` never finished, the hook died on timeout
  and the agent started up knowing nothing about the project, silently. The read now has a time
  cap and is skipped entirely when the caller has already said everything through arguments
  (`--cwd`, `--session`). Pi's extension also closes the child's `stdin`, uses the session's
  `cwd` rather than the process's and **waits** for the context to arrive before injecting it.

### Added
- **Prompts so your agent installs it.** Two blocks in the README, ready to paste into Claude
  Code, Codex or whichever: one installs and configures the whole machine, the other connects
  one more repository. They are explicit about the one thing an agent cannot do for you, which
  is reading the code that arrives by email, and about stopping when something fails instead of
  improvising.
- **Several Cortex instances at once** (ADR-0033). The server is a property of the repository:
  `.cortex.json` accepts a `server` field and the credentials keep one session per server,
  reading the previous format without forcing anyone to sign in again. The hooks, the CLI and
  the MCP proxy resolve which one to talk to from the folder being worked in, and the token is
  looked up per server. With more than one session, `cortex link --create` demands you say which
  one: it is the only point where one client's project could be created on another's server.
  `cortex auth status` and `cortex doctor` check them all. New `cortex auth use <url>`.
- **Local mode, to try Cortex without deploying anything** (`deploy/local.yml`): a compose file
  that stands up Postgres, the API, the UI and the MCP on `127.0.0.1` with a single command, no
  domain, no TLS, no keys and without asking for a single environment variable. The data
  survives a restart, because a project memory only shows its worth once it has been
  accumulating for weeks. Before, the only way to see it working was to set up the whole
  production deployment.

### Changed
- The access code email, in English. It is the only product text that reaches somebody outside
  the application, and it had been left behind.
- **The web UI, in English.** With this, everything an outsider sees is: CLI, MCP tools, what
  they return, the plugin, the README and the web. The ADRs, the roadmap and the code comments
  stay in Spanish, being the team's working record. *(Superseded in [Unreleased]: the whole
  repository is in English now.)*
- **The text the MCP tools return, in English.** The previous pass translated the tools'
  descriptions but not what they return, which is exactly what the agent reads and often repeats
  to the user: the context pack, search results, the lint report and the confirmation on save.
  Each entry's content keeps the language it was written in; what gets translated is the
  scaffolding.
- **README in English and the internals guide as a page of its own**
  (`docs/how-it-works.md`, 498 lines). The README goes from 872 lines to 407 and keeps the
  practical part; the guide explaining embeddings, RAG, the graph and the seven agents from
  scratch is worth more as a linkable piece than buried at line 400 of a README. Seven claims
  that were no longer true were corrected, verified against the code: default models, providers,
  document slicing, embedding dimensions and configurable thresholds.
- Documentation consolidated for v0.1.0: the roadmap stops listing as pending what is already
  done and keeps what is genuinely missing; the README, `CLAUDE.md` and `CONTRIBUTING.md`
  describe the product that exists today, not the one you used to clone. There are tests
  watching the internal links, the ADRs cited and that no corporate material slips in.

### Added
- **A complete production deployment** (ADR-0027): a three-stage image with no devDependencies
  and no sources, running as the `node` user; Caddy in front with automatic TLS and a single
  domain (`/` the web, `/api` the API, `/mcp` the MCP, `/install.sh` the installer); Postgres
  with no published ports; a daily backup with 7d/4w/6m retention; `deploy/restore.sh` with a
  drill mode and `deploy/backup-now.sh`; and `deploy/README.md` with the procedures for
  updating, restoring and rotating credentials.
- **A real `/health`** in the API, the web and the MCP: it does `select 1` and returns 503 when
  the database does not answer. They used to say `ok` for as long as the process was alive,
  which is exactly what you must not tell an orchestrator. The worker, which listens on no port,
  leaves a heartbeat file the compose watches.
- Security headers on all three apps and `CORTEX_BIND_HOST` to pick which interface they listen
  on. Local only by default: facing the network is a decision for whoever deploys.
- **The CLI is published to npm as `@dinacodelabs/cortex`**: a single ~110 KB file with
  `@cortex/client` and `@cortex/shared` inside, and only three public dependencies outside (the
  MCP SDK, zod and yaml). Installed globally it takes 24 MB, against the ~235 MB of the monorepo
  clone it used to need.
- **`cortex version`** (and `--version`): the CLI's version, the server's, and the minimum client
  version the server demands. **`cortex upgrade`** installs the latest published one and reminds
  you to run `cortex setup --all` afterwards.
- **`cortex doctor`**: checks Node, the session, the server, the token, the MCP, this folder's
  link and each agent's integration in one go, and says which command fixes each failure. It
  exits with code 1 only when something genuinely stops Cortex from working.
- **`cortex toolbelt sync|doctor`**: installs your organisation's registry (third-party MCPs,
  skills and commands) into the detected agents. A dry run by default, `--apply` to write. An
  entry missing its environment variable is skipped with a warning: an MCP that is registered
  and broken is worse than one that is absent.
- **`cortex setup` covers all five agents**: Claude Code and Codex share the plugin (Codex reads
  the same marketplace; only its MCP is registered separately), OpenCode gets a JS plugin that
  injects the context and captures when the session goes idle, Pi an extension that injects the
  context as a session message and captures on close, and Hermes its hooks and its MCP in
  `config.yaml`. All of them with a backup, idempotence and `--remove`.
- **`cortex hook-capture --platform`** with automatic detection: since the plugin is the same
  for several agents, the hook works out which one from the transcript's path. It accepts
  `--session` (an id or a path) and `--cwd`, and on Codex, when the event carries neither, it
  uses that repo's most recent session.
- **Per-agent session readers**: Pi (new), and the "one single session" variants of Codex,
  OpenCode and Hermes that the hook needs. `cortex connect-sessions` accepts `pi` now.
- **`cortex setup <agent>|--all`**: installs Cortex's integration into your team's agents with
  each one's native mechanism. Idempotent, with a backup before touching anything, `--dry-run`,
  `--remove` and `--status`. Installing the CLI and configuring the agents become two different
  things: you can reconfigure without reinstalling (ADR-0032).
- **A Claude Code plugin** (`plugin/claude-code/`, the `dinacode-cortex` marketplace declared in
  this same repo): context and capture hooks, the `cortex mcp` MCP, the `cortex-capture` skill
  and `/cortex-save` in a single package the user sees and controls from `/plugin`. When it
  cannot be installed (a private repo with no access), `setup` falls back to hooks in
  `~/.claude/settings.json` and works just the same.
- **Migration from the previous installation**, inside `cortex setup` itself: the
  `pnpm -C <clone> cortex hook-*` hooks are replaced in place rather than duplicated, the MCP
  that pointed at the cloned repo is re-registered against the server, the symlinks into
  `config/` are withdrawn and the `~/.local/bin/cortex` shim is deleted. The clone in
  `~/.dinacode-cortex` is flagged but not touched: it may hold a `.env` with keys.
- **`cortex mcp`**: an MCP server over stdio that bridges to the server's HTTP MCP,
  authenticated with the token from `cortex auth login`. It is what gets registered in the
  agents (`claude mcp add cortex -- cortex mcp`): the local process never touches the database
  and the tools respect the user's permissions. With no session, or an expired token, the agent
  **still starts** (an empty tool list and a warning), rather than failing to initialise
  (ADR-0025).
- `CORTEX_HOME` replaces `~` when looking for `~/.cortex/credentials`, so a separate session can
  be used in tests without trampling the user's.
- **`cortex-admin`**: the operator commands (migrate, seed, ingest, maintain, enrich, lint, the
  heavy connectors and the services) leave the CLI for an app of their own, which lives in the
  deployment image. The `cortex` CLI keeps the developer side and stops depending on Postgres,
  Mastra and document extraction (ADR-0025).
- **Session distillation on the server** (`POST /capture/session`): the hooks send the condensed
  and scrubbed transcript, and the server distils it with its own key. No laptop needs LLM
  credentials any more. Idempotent per session — the hooks fire several times over the same
  one — and when the session has grown, only the new part is distilled (ADR-0025).
- **New API endpoints**: `GET /client-config` (public: the MCP's URL, the version and the
  minimum client version, so the CLI guesses nothing), `GET /version`, `GET /toolbelt.json`,
  `GET /projects/:slug` and `POST /projects`. With them, `cortex link` stops needing Postgres.
- **`@cortex/client`**: a new package with the whole client side (credentials, HTTP, the API's
  typed client, `.cortex.json`, transcripts). It depends on `@cortex/shared` alone, with no
  Postgres and no Mastra, which is what will allow the CLI to be distributed with `npm i -g`
  (ADR-0025). The API contracts move to `shared/api-contract.ts`, shared by server and client so
  they cannot drift apart.
- **A compiled build**: `pnpm build` (`tsc -b` with project references) generates a `dist/` in
  every package and server app, and Docker starts `node dist/...` instead of transpiling with
  `tsx` on every boot. Developing still needs no build, thanks to a `development` condition in
  the `exports` (ADR-0030).
- An `openai-compatible` provider for the LLM and for embeddings: it works for NaN, Ollama, vLLM
  or LM Studio with the same configuration. `CORTEX_MODEL_<ROLE>` accepts `provider:model` to
  send one single role to another provider (ADR-0024).
- A `CORTEX_LLM_CONCURRENCY` semaphore (default 4) shared by chat, vision, STT and embeddings:
  the provider's limit is per API key, not per endpoint.
- `CORTEX_PRICING_JSON` to correct or register model prices without deploying.
- Configurable branding: `CORTEX_BRAND_NAME` and a logo through `CORTEX_BRAND_LOGO_SVG` /
  `CORTEX_BRAND_LOGO_FILE` (ADR-0013 revised).
- Pluggable transactional email: `CORTEX_EMAIL_PROVIDER=log|brevo|smtp`, validated when the
  server starts (ADR-0028).
- Apache-2.0 licence, `NOTICE`, `SECURITY.md`, a code of conduct, issue/PR templates and
  Dependabot (ADR-0029).
- `docs/toolbelt-registry.md`: the registry's schema, so an organisation can declare its own
  toolbelt outside this repo.

### Removed
- **`cortex sync`**. It did two things at once: install Cortex and distribute the company's
  tools. They are now `cortex setup` and `cortex toolbelt sync`, and whoever types the old
  command gets a message explaining it. The `~/.local/bin` shim goes with it.

### Changed
- **The product surface moves to English**: the descriptions of the 8 MCP tools (a model that
  may be working in any language reads them), the CLI's messages, the `cortex-capture` skill,
  `/cortex-save` and the API errors the CLI consumes. The LLM agents' prompts stay in Spanish —
  the corpus is — and so do the ADRs, the roadmap and the code comments. The web UI gets
  translated later. *(Superseded in [Unreleased]: the whole repository is in English now.)*
- **`install.sh` no longer clones the repo**: it installs the CLI from npm, signs in and calls
  `cortex setup --all`. Node is not installed on its own initiative — pushing a version onto
  somebody behind their back breaks their other projects — it demands ≥ 20 and offers three ways
  to get it. The typical failures (npm without permissions, `cortex` outside the PATH) come with
  the exact command that fixes them.
- `cortex link` goes through the API instead of the database: it was the last CLI command that
  needed Postgres.
- `cortex hook-capture`, `connect-sessions` and `connect-meeting` no longer call the model: they
  only condense and send. The pipeline that distilled on the client disappears.
- The **internal process** documentation (the security audit, the refactor plan, the model
  strategy with costs and the ingestion research tied to one provider) leaves the repo: opening
  the code is not opening the process. The criterion for what gets published and what does not
  is in ADR-0031.
- `nan` becomes a **deprecated alias** for `openai-compatible` (it warns when used; it is
  withdrawn in 0.2.0). The same for `EMBEDDINGS_PROVIDER=nan`.
- `CORTEX_AUTH_DOMAIN` and `BREVO_SENDER` lose their default value: they depended on the domain
  of whoever wrote the product. With no `CORTEX_AUTH_DOMAIN` anybody can sign up, and the server
  warns about it at startup.
- The corporate toolbelt leaves the repo for a private one; `config/toolbelt.json` is left with
  the product's own (ADR-0014 revised, ADR-0026).
- Test fixtures moved to `example.com`; references to real clients neutralised.
- `xlsx` is installed from SheetJS's official CDN (0.20.3) instead of npm, whose version is
  abandoned with two unfixed CVEs.

### Fixed
- When the command Pi's extension runs fails, it now says so on stderr. It used to swallow it
  and the agent started with no context without anything indicating it.
- **The memory stopped recognising what it already knew when it came from somewhere else.** The
  reconciliation NOOP required `sourceType` to match, so an entry distilled from a session was
  never compared against the same information captured by hand. The effect, seen while testing
  with real agents: the agent repeats in its answer what the memory has just told it, capture
  distils that, and the memory fills up with echoes of itself. Recognising a near-identical no
  longer depends on the origin. Modifying curated knowledge still requires it, which is what
  actually needed protecting.
- **`cortex setup` no longer falls over a broken symlink** from the previous installation. When
  the skill and the command moved inside the plugin, the links `cortex sync` had left pointing
  at the cloned repo were left dangling, and writing through one fails with ENOENT. It brought
  down the whole `setup --all`. The link is now replaced by a real file, which also fixes the
  worst case: with a LIVE link you would be writing inside somebody else's repo. Found while
  migrating a real machine.
- **A rejected inference key no longer passes for "there was nothing to save".** The distiller
  swallowed any error from the window, so a 401 from the provider returned `saved: 0, failed: 0`
  and status `done`: all green, zero knowledge, and so on indefinitely. A rejection from the
  provider now surfaces and the capture is marked failed with its reason. The rest (invalid
  JSON, a window that yields nothing) is still skipped, which genuinely is recoverable. Found
  while deploying the production server.
- The three sign-up errors a user sees (a mistyped email, a domain that is not allowed, too many
  codes in a row) were still in Spanish. They were spotted on deployment: they are the first
  thing somebody reads when they try to get in and cannot.
- `cortex link` no longer blows up while listing when an old project has no slug. One piece of
  old data brought the whole command down instead of listing the rest.
- `scrub()` is applied on **every** capture path: until now only Claude's transcripts reached the
  model clean; those from Codex, OpenCode, Hermes and meetings went raw. The server also cleans
  what it receives again, without trusting the client.
- `resolveEntities` grouped by name ignoring the type, so it merged different entities and
  deleted the loser with no way back. The key now includes the type.
- Picking the canonical entity had no stable tie-break and depended on Postgres's row order; it
  was the cause of an intermittent integration test.
- `loadEnv` resolved the `.env` relative to its own source file, so it broke on compiling or on
  moving the package. It now looks by `CORTEX_ENV_FILE`, `INIT_CWD` and cwd.
- An environment variable declared but empty did not fall back to its default:
  `EMBEDDINGS_PROVIDER=` broke startup instead of using `local`, and an empty key cut the
  fallback chain short.
