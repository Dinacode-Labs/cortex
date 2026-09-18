---
paths:
  - "apps/web/**/*.ts"
  - "apps/web/public/**"
---

# Web UI

**Read `docs/design.md` before touching anything here.** It says what the interface exists for and
what it does not, and it is what stops unusable screens from coming back.

The thesis, in one line: **agents write and people check**. The UI is where a human audits and
repairs a memory written by machines — it is not a data-entry tool, not a dashboard, and not the
main way anyone uses Cortex.

## Rules

- **Server-rendered, no build step** (ADR-0042). Hono + `hono/html`, which autoescapes every
  interpolation. `raw()` **only** over configuration SVG or literals from the file itself, **never**
  over data.
- **The web talks to `core` directly**, never to the HTTP API: do not add a `fetch("/api/…")` from
  a handler.
- **Components, not loose HTML**: the building blocks are in `views/components.ts` and routes
  compose them (ADR-0053). If a component does not fit, fix the component.
- **Tokens, not hardcoded values**: one stylesheet is the design system. If the number you need is
  not in the scale, either the scale is wrong or the design is.
- **Everything hangs off the project** (`/p/<slug>/…`, ADR-0050), and old URLs redirect: a link
  somebody pasted in a chat three weeks ago still works.
- **No screen that shows a problem and offers no way to fix it**: it teaches people to ignore it.
- **The product name never appears in the markup**: branding is configuration (`getBrandName()`).
  The default mark comes from `markSvg()` in `@cortex/shared` (one 8×8 drawing shared with the
  favicon and the CLI); its header animation is scoped to `mark-relay`, so an operator's logo
  never moves.
- Access is decided by `checkProjectAccess`, and "you cannot see it" renders as "it does not
  exist".
- Inheritance goes **up**: a child reads what its client knows, never what a sibling knows.
  Crossing downwards is a deliberate act, filtered by access (ADR-0063).
