# The Quiet Vale - Tile Wireframe Templates v0.2

Prototype alignment notes for the current tile template pass.

## Core basic side

- Uses the existing full core tile structure.
- Keeps `Place` and `Upgrade` as text labels.
- Costs remain written as text, such as `2x Wood`, rather than icon-only costs.
- Tile type and requirement badges now use the supplied SVG icon assets when available.

## Core upgraded side

- Uses the same lower band geometry as the basic side.
- The upgraded lineage band aligns to the full combined basic-side cost area:
  - top boundary matches the top of the `Place` cost row: `y=430`
  - bottom boundary matches the bottom of the `Upgrade` cost row: `y=590`
- `Upgraded [base tile]` is centered inside that combined band.
- The shorter upgraded-name box shown in the interim v1.7.38 draft is not used.

## Special one-sided tiles

- Uses the v0.2 special tile layout from the supplied handoff.
- Removes the old lower placement row.
- Removes Place and Upgrade cost rows.
- Placement is represented only by the top-right requirement badge.
- Keeps the visible `Unlocked by Arrival` line.
- Uses the larger lower rules field for the special tile effect.

## Placement icon decision

No icon has been added for `Place` yet. The current recommendation is to keep `Place` as text until a dedicated icon is intentionally added to the official icon set.
