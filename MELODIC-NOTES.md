# Melodic packages — usage notes & improvement candidates

How the Envy redesign leans on `@melodicdev/*`, and the gaps worth prompting in
the `@melodicdev/components` / `@melodicdev/core` repos.

## Theming win (the sales pitch, working)

The whole green design is driven by mapping the `--ev-*` palette onto Melodic's
`--ml-*` semantic tokens in `src/ui/public/tokens.css` (dark + light). Every
`ml-*` element themes itself with **zero per-component CSS**. This is the
"flexible / reusable / themeable" story end-to-end — one palette → both the
component library and the bespoke surfaces.

## Used `@melodicdev/components` directly

- `ml-icon` — all iconography (Phosphor names) across every screen.
- `ml-button` — every action/CTA (start/stop/restart, pull, add, enable, group
  start-all, drawer actions, danger confirms via `variant="danger"`).
- `ml-input` — image pull, image filter, domain add.
- `ml-spinner` — busy/loading states.

Framework: `@melodicdev/core` (`MelodicComponent`, `html`, `css`, `signal`,
lifecycle `OnCreate`/`OnRender`/`OnDestroy`, `IElementRef`) powers **all** Envy
components.

## Rolled custom on `@melodicdev/core` (and why)

These were built as custom components/markup styled with the shared tokens —
either bespoke to the design or because I hadn't verified the library
component's API. **Candidates to convert to `ml-*` once we confirm the API** (and
where package gaps would surface):

| Custom piece | Could be | What the component needs to fit |
|---|---|---|
| App sidebar + nav | `ml-sidebar` / `ml-sidebar-item` | custom active token color, window-drag (`-webkit-app-region`) passthrough, footer slot |
| Service card / group container | `ml-card` | flexible header/body/footer slots, no forced padding |
| Inspect drawer | `ml-drawer` | right-side, fixed width, scrim-click close, header+footer slots, our slide-in timing |
| Logs/Shell tabs | `ml-tabs` / `ml-tab` | lightweight inline tab style, controlled active state |
| Activity tree table | `ml-table` / `ml-data-grid` | **grouped/collapsible rows** + **custom cell renderers** (sparklines) |
| Inspect env/mounts table | `ml-table` | simple 2-col key/value, monospace |
| URL chip, pulsing status dot, sparklines, daemon status pill | — | inherently bespoke; likely stay custom |

## Concrete improvement candidates to prompt

1. **`ml-button` radius override.** Setting `--ml-button-border-radius` from an
   outer rule (or inline) did **not** override the component's internal `:host`
   default reliably (cascade/specificity across the shadow boundary). Consider:
   the internal default should be a *fallback* (`var(--ml-button-border-radius, …)`)
   that consumer values beat, or expose `::part(button)`. (Worked around by
   matching the container radius instead.)
2. **`ml-skeleton` / shimmer component** — none exists; rolled a custom shimmer
   for the Services first-boot loading. Good candidate for the library.
3. **`ml-table` / `ml-data-grid`: grouped/collapsible rows + custom cell
   renderers** — needed for the Activity monitor (Compose-project groups with
   subtotals, per-row sparklines). If supported, document it; if not, a feature.
4. **`ml-drawer` API confirmation** — width, scrim-click-to-close, header/footer
   slots, and entrance timing, so we can replace the custom drawer.
5. **Input prefix slot** — the Domains add field shows a faint `*.` prefix; done
   with absolute positioning + `--ml-input-padding-left`. A real prefix/affix
   slot on `ml-input` would be cleaner.

## Next step

Read the actual APIs of `ml-sidebar`, `ml-card`, `ml-drawer`, `ml-tabs`,
`ml-table` and convert the custom pieces above where they fit — filing the gaps
that don't as prompts for the Melodic repos.
