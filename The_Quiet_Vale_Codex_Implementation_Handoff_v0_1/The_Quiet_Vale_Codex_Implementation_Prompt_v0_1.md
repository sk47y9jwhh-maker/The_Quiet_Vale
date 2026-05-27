# The Quiet Vale - Codex Implementation Prompt v0.1

You are implementing a local, rules-correct virtual prototype for **The Quiet Vale: Seasons of Settlement**. Your goal is not final visual polish. Your goal is to create an inspectable MVP that can support local playtesting of the standard 1-4 player game.

## Source hierarchy

Use the provided source pack as authoritative, in this order:

1. `The_Quiet_Vale_Production_Rulebook_v1_4_2_River_Rules_Update.docx` - rules meaning and timing.
2. `The_Quiet_Vale_Codex_Source_Tables_v0_3_Map_Approved.xlsx` - structured source tables.
3. `The_Quiet_Vale_Codex_JSON_Exports_v0_4_Implementation_Ready.zip` - implementation-ready JSON exports derived from the source tables.
4. `The_Quiet_Vale_Codex_Simulation_Brief_v0_3_Map_Approved.docx` - implementation brief and project framing.
5. `The_Quiet_Vale_Hex_Map_Refinement_Workbook_v0_5_Codex_Default_Map_Approved.xlsx` - map review workbook and approved default map.
6. Visual files are reference only at MVP stage: `option_01_balanced_v04_flat_top_visual.png`, `Draft Map v0_1.png`, `Icon Guide.png`.

Treat the JSON exports as the primary implementation input after validating that counts match the source workbook:

- `encounter_cards.json`: expected 80 rows.
- `tiles.json`: expected 77 rows.
- `codex_default_map_v0_1.json`: expected 126 rows.
- `river_rules.json`: expected 11 rows.

If a JSON file conflicts with the source workbook, stop and report the discrepancy rather than guessing.

## Scope

Build the standard 1-4 player game only.

Include:

- 1, 2, 3, and 4 player setup.
- Hidden Encounter hands.
- Encounter seeding.
- Encounter reveal with Golden Boon extra-reveal handling.
- Three Seasons, 15 total rounds.
- Four actions per player per round.
- Shared Warehouse with 15-per-resource cap.
- Tile placement, upgrade, activation, and reachability.
- Strain, Supported, and Overstrained.
- Burden reveal, active state, reapplication, and resolution.
- Arrival timers, completion, unlocks, and Special Tile placement.
- Final Population + Renown scoring and penalties.
- Debug logs for every state mutation.

Defer:

- Council Variant.
- Artist Mode.
- Final artwork.
- Printer-accurate card/tile layout.
- Online multiplayer.
- AI/autoplayer logic.
- Achievements beyond simple score visibility, unless trivial to include from source data.

## Technical direction

Use a local-first implementation. Preferred stack unless an existing repo dictates otherwise:

- Vite + React + TypeScript for UI.
- Plain TypeScript rules engine modules under `src/game`.
- JSON source files under `src/data`.
- Unit tests with Vitest.
- Browser-local state only for MVP; optional import/export save JSON.

Keep game logic separate from UI. The rules engine should be usable from tests without rendering React components.

Suggested structure:

```text
src/
  data/
    encounter_cards.json
    tiles.json
    codex_default_map_v0_1.json
    river_rules.json
    rules_config.json
  game/
    types.ts
    setup.ts
    deck.ts
    map.ts
    travel.ts
    tiles.ts
    encounters.ts
    warehouse.ts
    strain.ts
    scoring.ts
    actions.ts
    reducer.ts
    validation.ts
  ui/
    App.tsx
    components/
  tests/
    setup.test.ts
    map.test.ts
    river.test.ts
    encounters.test.ts
    strain.test.ts
    scoring.test.ts
```

## Core data model

Implement explicit typed objects for:

- `GameState`
- `PlayerState`
- `EncounterCard`
- `TileDefinition`
- `PlacedTile`
- `MapHex`
- `WarehouseState`
- `ArrivalState`
- `BurdenState`
- `ActionLogEntry`

Every action should return a new state plus log entries, or mutate only through one controlled reducer/action dispatcher.

## Setup requirements

Standard game setup:

- Build a balanced Encounter pool with 5 Boons, 5 Burdens, and 5 Arrivals per player.
- Shuffle the game pool.
- Deal 10 hidden Encounter Cards to each player.
- Deal 5 standard Encounter Cards per player to the Encounter Deck.
- Add exactly 1 random Golden Boon to the Encounter Deck.
- Do not deal Golden Boons to player hands.
- Use the approved `Codex Default Map v0.1`.
- Use flat-top hex adjacency only.

For deterministic testing, support a seeded random number generator or deterministic deck setup.

## Map and river requirements

The map is a 14 x 9 flat-top hex grid using coordinates A1-I14.

Rules:

- Use flat-top hex adjacency only.
- Spreadsheet/cell adjacency is not authoritative.
- River/Water hexes are restricted placement spaces.
- No tile may be placed on a River hex unless the tile explicitly permits River placement.
- Bridge is the normal tile placed on a River hex.
- Bridge is a Travel Tile.
- Travel Tiles adjacent to a Bridge connect through that Bridge, including across the river.
- Docks and Washhouse/Bathhouse-style tiles are placed adjacent to a River hex, not on the River, unless the specific tile text says otherwise.
- Crossing the river without a Bridge costs 1 Action.
- An Overstrained Bridge loses Travel connectivity.

Acceptance tests:

- Approved map has 126 hexes.
- Approved river is one connected Water component under flat-top adjacency.
- There are no ponds or isolated Water hexes.
- Bridge candidates are on Water hexes.
- River-adjacent land sites are computed from flat-top adjacency.

## Round flow

Each round:

1. Seed Encounter Cards.
2. Reveal Encounters.
3. Player Turns.
4. End of Round.

Golden Boon reveal exception:

- A Golden Boon does not count toward the number of standard Encounter Cards revealed for the round.
- When revealed, resolve it, then continue revealing until the required number of standard Encounter Cards has been revealed.

End of round:

- Remove 1 timer from each active Arrival.
- Expire failed Arrivals with no timer tokens remaining.
- Discard applicable Boons.
- Resolve other end-of-round effects.
- Advance round timer.

Start of Season II / III:

- At start of Round 6, unresolved active Burdens reapply using Season II effect.
- At start of Round 11, unresolved active Burdens reapply using Season III effect.

## Tile actions

Implement these action types:

- Place a Tile.
- Upgrade a Tile.
- Activate a Tile.
- Interact with an Encounter Card.
- Travel to a Disconnected Tile.
- Cross River without Bridge.

Validation should explain why an action is illegal. Do not silently fail.

## Encounters

Card type handling:

- Boon: resolve the current Season effect. If the Boon modifies a later action, keep visible according to its text.
- Burden: apply current Season effect, then place on Stewards Board as active Burden.
- Arrival: place on Stewards Board with 3 timer tokens.
- Golden Boon: resolve its bespoke Effect and do not count it as a standard reveal.

Burden targeting:

- Burdens that place Strain can affect disconnected/unreachable tiles unless the card says otherwise.
- Overstrained tiles are not valid targets for further Strain placement.
- If fewer valid targets exist than requested, choose all valid targets.
- If no valid targets exist, no Strain is placed; the Burden remains active unless resolved.

Arrivals:

- Requirements are fulfilled all at once unless card text explicitly tracks progress.
- Completing an Arrival requires 1 Interact action while its Requirement is fulfilled.
- Completed Arrivals hold unlocked Special Tiles until placed.
- Unplaced Special Tiles are inert.

## UI requirements for MVP

Build a functional debug-first UI with:

- New game setup controls for 1-4 players.
- Map panel using flat-top hex layout.
- Current round and season display.
- Player hands, hidden from other players by default, with optional debug reveal toggle.
- Encounter Deck / discard / active board panels.
- Warehouse panel.
- Tile supply panel.
- Action log panel.
- Score breakdown panel.
- Debug mode to inspect deck order, map data, and validation reasons.

The UI may use simple colours and labels. Do not spend time on final art polish.

## Required tests

Implement at least these tests:

1. Player-count setup creates correct pool, hands, Encounter Deck, and Golden Boon count.
2. Golden Boon reveal does not consume a standard reveal slot.
3. Approved map has one connected river system under flat-top adjacency.
4. Bridge candidates are on Water hexes.
5. River crossing without Bridge costs an Action.
6. Bridge connects Travel Networks across river.
7. Overstrained Bridge does not provide Travel connectivity.
8. Supported prevents first Strain each round.
9. Overstrained tiles cannot activate, upgrade, provide passive effects, or contribute scoring.
10. Arrival timers decrement and failed Arrivals expire correctly.
11. Completing an Arrival unlocks its Special Tile and makes the Arrival completed, not active.
12. Burdens reapply at start of Rounds 6 and 11.
13. Final scoring subtracts active Burden and Strain penalties.

## Implementation order

1. Load JSON data and validate row counts.
2. Implement coordinate parsing and flat-top adjacency.
3. Implement map and river validation tests.
4. Implement setup and deterministic shuffle.
5. Implement GameState and reducer/action dispatcher.
6. Implement Warehouse and tile placement basics.
7. Implement Travel Network and river crossing.
8. Implement Encounter Deck reveal and active Encounter state.
9. Implement Strain, Supported, Overstrained.
10. Implement scoring.
11. Build minimal UI over the tested rules engine.
12. Add debug panels and export/import save state.

## Definition of done for MVP

The MVP is acceptable when:

- It runs locally from a clean checkout.
- It loads the approved source JSON without manual edits.
- It supports complete standard-game setup for 1-4 players.
- It can step through rounds and player actions.
- It validates legal/illegal placement and travel actions.
- It implements river/Bridge rules correctly.
- It logs every state change.
- It can calculate final score.
- All required tests pass.
- The UI is usable enough for a human to conduct playtest sessions.

## First response expected from Codex

Before coding, inspect the files and report:

1. Confirmed files found.
2. Confirmed row counts for encounters, tiles, map, and river rules.
3. Proposed repository structure.
4. Any source discrepancies or blockers.
5. The first implementation milestone you will commit.

Do not begin aesthetic card/tile artwork work until the rules engine and debug UI are passing tests.
