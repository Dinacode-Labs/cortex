# The Cortex mark

<img src="mark.svg" width="96" height="96" alt="The Cortex mark: two L-shaped pieces and a square in the centre" align="right">

**Relay.** Two L-shaped pieces and a square between them.

The pieces are sessions: the one that is ending and the one that is starting. The square is
what was learned, and it never moves. In the animation the pieces leave by their corners and
come back — replaced, while the centre stays put. That is the product in one gesture:
*sessions change; knowledge stays.*

The centre takes the accent because it is the only thing that matters. The pieces are quiet:
hollow with a hairline stroke on light, solid white on dark, the terminal's own foreground in
the CLI. The mark is deliberately not a brain, a graph or a bracket; it says one thing and
nothing else.

## How it is built

One drawing, an **8×8 grid**, in `MARK_GRID` (`packages/shared/src/brand.ts`):

```
XXXXX...
XXXXX...
XX......
XX.XX.XX
XX.XX.XX
......XX
...XXXXX
...XXXXX
```

Everything renders from it, so the mark is the same drawing everywhere it appears:

| Surface | Rendering | Where |
| --- | --- | --- |
| Web header (28 px) | `markSvg()`, hollow pieces, accent centre, one-shot animation on sign-in and home | `apps/web/src/views/layout.ts`, `apps/web/public/styles.css` |
| Favicon (16 px) | `/favicon.svg`, 2 px per cell, 1 px stroke; solid light pieces on dark tabs | `apps/web/src/app.ts` |
| CLI splash | `▀` per cell, so the grid shows; centre in blue, pieces in the terminal foreground | `apps/cli/src/splash.ts` |
| README | `docs/brand/mark.svg`, generated from the same function | this folder |

The grid is why it works at 16 px and in a terminal: there is nothing to rescale, and there is a
one-cell gap between the pieces and the centre so the three parts stay three parts.

## Rules

- **One accent, one drawing.** No gradients, no text, no second hue. Monochrome must still read.
- **The mark is the default, not the product name.** An operator who sets `CORTEX_BRAND_NAME`
  or `CORTEX_BRAND_LOGO_SVG` gets their own name and logo, unanimated, and the CLI shows no
  Cortex mark at all.
- **The animation runs once and settles.** Sign-in and the projects index only. Never on a
  favicon. `prefers-reduced-motion` and `NO_COLOR` are honoured.
- **Change it in one place.** If the mark ever changes, change `MARK_GRID` and its parts; the
  web, the favicon and the CLI follow. `tests/mark.test.ts` pins the drawing.

This is visual judgement, not architecture, so there is no ADR for it. The story of how it was
chosen — six generated concepts, four rounds, and what was rejected and why — lives with the
team, not here.
