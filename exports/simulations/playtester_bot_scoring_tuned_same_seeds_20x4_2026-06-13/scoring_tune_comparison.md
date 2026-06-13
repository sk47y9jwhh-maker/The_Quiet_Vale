# Playtester Bot Scoring Tune Comparison

Baseline: `playtester_bot_roads_too_far_softened_same_seeds_20x4_2026-06-13`.
Tuned run: `playtester_bot_scoring_tuned_same_seeds_20x4_2026-06-13`.
Same seed prefix: `playtester-bot-balance-2026-06-13`.

## Score Summary

| Players | Avg Score Before | Avg Score After | Change | Min Before | Min After | Max Before | Max After |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 94.35 | 119.90 | +25.55 | 52 | 68 | 130 | 144 |
| 2 | 146.15 | 160.65 | +14.50 | 21 | 108 | 219 | 215 |
| 3 | 208.80 | 267.15 | +58.35 | 71 | 182 | 298 | 339 |
| 4 | 213.20 | 244.95 | +31.75 | 94 | 167 | 342 | 346 |

## Behaviour Summary

| Players | Arrival Timer Uses Before | After | Travel Tiles Before | After | Housing Tiles Before | After | Upgrades Before | After |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.00 | 0.00 | 7.10 | 4.45 | 3.75 | 5.80 | 3.05 | 4.90 |
| 2 | 3.30 | 0.50 | 13.75 | 6.80 | 4.50 | 5.30 | 11.55 | 15.95 |
| 3 | 11.05 | 1.80 | 13.65 | 9.80 | 5.80 | 7.55 | 15.35 | 20.35 |
| 4 | 7.65 | 3.65 | 17.15 | 11.65 | 4.40 | 6.15 | 18.40 | 23.10 |

## Penalty / Raw Score Summary

| Players | Raw Score Before | Raw Score After | Burden Penalty Before | After | Strain Penalty Before | After |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 107.55 | 131.70 | 7.80 | 6.60 | 5.40 | 5.20 |
| 2 | 174.45 | 190.65 | 15.90 | 17.70 | 12.40 | 12.30 |
| 3 | 239.80 | 298.65 | 12.60 | 11.70 | 18.40 | 19.80 |
| 4 | 262.50 | 299.85 | 18.30 | 19.20 | 31.00 | 35.70 |

## Old Crash Seeds

- `sim-balanced-2p-008`: 21 -> 134; Housing 5 -> 4; Travel 15 -> 8; Arrival timer uses 0 -> 0.
- `sim-balanced-4p-018`: 94 -> 206; Housing 1 -> 6; Travel 13 -> 12; Arrival timer uses 46 -> 13.
- `sim-balanced-3p-018`: 71 -> 182; Housing 2 -> 5; Travel 12 -> 10; Arrival timer uses 24 -> 2.
- `sim-balanced-3p-010`: 72 -> 242; Housing 2 -> 3; Travel 8 -> 11; Arrival timer uses 35 -> 6.
- `sim-balanced-1p-012`: 61 -> 68; Housing 0 -> 4; Travel 10 -> 2; Arrival timer uses 0 -> 0.

## Lowest Tuned Games

| Game | Players | Score | Raw | Burden Penalty | Strain Penalty | Housing | Upgraded Housing | Travel | Upgrades | Arrivals Completed/Expired |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `sim-balanced-1p-012` | 1 | 68 | 68 | 0 | 0 | 4 | 1 | 2 | 7 | 5/0 |
| `sim-balanced-1p-007` | 1 | 77 | 79 | 0 | 2 | 5 | 4 | 0 | 6 | 4/1 |
| `sim-balanced-1p-006` | 1 | 85 | 117 | 18 | 14 | 5 | 0 | 6 | 7 | 3/0 |
| `sim-balanced-1p-003` | 1 | 95 | 119 | 6 | 18 | 3 | 0 | 6 | 6 | 4/0 |
| `sim-balanced-2p-001` | 2 | 108 | 136 | 18 | 10 | 3 | 0 | 8 | 13 | 8/2 |
| `sim-balanced-2p-011` | 2 | 108 | 156 | 24 | 24 | 7 | 4 | 2 | 14 | 4/5 |
| `sim-balanced-1p-018` | 1 | 110 | 128 | 12 | 6 | 5 | 0 | 6 | 6 | 3/0 |
| `sim-balanced-1p-014` | 1 | 113 | 129 | 6 | 10 | 4 | 2 | 6 | 8 | 2/1 |
| `sim-balanced-1p-019` | 1 | 113 | 121 | 6 | 2 | 6 | 0 | 6 | 2 | 3/1 |
| `sim-balanced-2p-017` | 2 | 116 | 136 | 18 | 2 | 1 | 0 | 8 | 16 | 5/1 |
| `sim-balanced-1p-016` | 1 | 118 | 126 | 6 | 2 | 7 | 0 | 3 | 3 | 5/0 |
| `sim-balanced-1p-004` | 1 | 123 | 143 | 18 | 2 | 6 | 1 | 6 | 4 | 4/1 |

## Interpretation

- The old severe outliers largely disappear. The old 2-player crash seed improves from 21 to 134, and the old 4-player crash seed improves from 94 to 206.
- The tuning reduced Travel overbuilding and converted more actions into Housing/upgrades, especially at 3-4 players.
- Arrival timer activations fall sharply at 3-4 players, which means the bot is no longer spending entire late rounds keeping marginal Arrivals alive.
- 4-player average score rises, but not wildly; remaining low 4-player games appear to be normal board-pressure variance rather than single-card collapse.
- 1-player scores are now more stable, but a couple of lower games remain. Those are mostly low raw-score games rather than penalty disasters.
