# The Quiet Vale Bot Rerun - Roads Too Far Softened

Baseline: exports/simulations/playtester_bot_burden_smoothing_same_seeds_20x4_2026-06-13
Current: exports/simulations/playtester_bot_roads_too_far_softened_same_seeds_20x4_2026-06-13

Change tested: Roads Too Far Season III places 1 Strain on each chosen Travel Tile instead of 2.

## Average Deltas

| Players | Score | Active Burdens | Strain Placed | Strain Removed | Arrivals Completed | Upgrades | Travel Tiles | Housing Tiles |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 94.35 (+0) | 1.3 (+0) | 3.05 (+0) | 0.3 (+0) | 3.6 (+0) | 3.05 (+0) | 7.1 (+0) | 3.75 (+0) |
| 2 | 146.15 (+1.35) | 2.65 (+0) | 9 (-0.6) | 1.65 (-0.3) | 5.65 (+0) | 11.55 (+0.05) | 13.75 (+0) | 4.5 (+0) |
| 3 | 208.8 (+3.85) | 2.1 (-0.05) | 12.15 (-0.55) | 1.5 (-0.2) | 8.5 (+0) | 15.35 (+0.1) | 13.65 (-0.1) | 5.8 (+0.1) |
| 4 | 213.2 (+10.75) | 3.05 (-0.1) | 20.35 (-1.6) | 3.05 (-0.5) | 7.65 (+0) | 18.4 (+0.5) | 17.15 (-0.05) | 4.4 (+0.1) |

## Score Extremes

| Players | Baseline Min | Current Min | Delta | Baseline Max | Current Max | Delta | Lowest Current Seed |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 52 | 52 | +0 | 130 | 130 | +0 | playtester-bot-balance-2026-06-13-deal-06-1p |
| 2 | 12 | 21 | +9 | 219 | 219 | +0 | playtester-bot-balance-2026-06-13-deal-08-2p |
| 3 | 63 | 71 | +8 | 298 | 298 | +0 | playtester-bot-balance-2026-06-13-deal-18-3p |
| 4 | 88 | 94 | +6 | 318 | 342 | +24 | playtester-bot-balance-2026-06-13-deal-18-4p |

## Roads Too Far Totals

| Version | Revealed | Resolved | Active Final | Target Misses | Strain Added | Resolution Actions |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 33 | 21 | 10 | 6 | 118 | 21 |
| Current | 33 | 21 | 10 | 6 | 62 | 21 |

## Initial Read

- This is a clean targeted softening: 1p is unchanged, while 2p/3p/4p move up modestly.
- Roads Too Far total Strain dropped from 118 to 62, without removing the card as a meaningful Travel pressure.
- The worst 2p and 4p outliers still exist, so the remaining problem is likely bot planning / Housing underbuilding / unresolved Burdens rather than this one card alone.
