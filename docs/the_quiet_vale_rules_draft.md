# The Quiet Vale - Rules Draft for Production Documents

Draft date: 2026-05-28  
Project: The Quiet Vale: Seasons of Settlement  
Document status: working production draft compiled from repository source files.

## Source And Scope

This draft uses the repository as source of truth, especially:

- `The_Quiet_Vale_Codex_Implementation_Prompt_v0_1.md`
- `src/data/rules_config.json`
- `src/data/tiles.json`
- `src/data/encounter_cards.json`
- `src/data/redesigned_basic_map_v0_2.json`
- `docs/prototype_rules_coverage_notes.md`

The implementation prompt names a production rulebook docx as the highest source, but that exact file is not present in the current repository checkout. Treat this document as a repo-derived production draft, suitable for editing into finished rulebook copy.

This document covers the standard 1-4 player game only. It intentionally excludes the Council Variant, Artist Mode, online multiplayer, final artwork, and printer-accurate layout.

## Game Overview

The players guide a settlement through three Seasons. Over 12 rounds, players seed and reveal Encounter Cards, place and improve tiles on the approved hex map, manage a shared Warehouse, complete Arrivals to unlock Special Tiles, and resolve or endure Burdens. The final score is Population plus Renown, reduced by active Burdens and remaining Strain.

## Component Summary

| Component | Quantity | Notes |
| --- | --- | --- |
| Map board / coordinate map | 1 | Redesigned Basic Map v0.2; 126 flat-top hexes; terrain counts: Arable Land: 6, Grasslands: 75, Heaths: 6, Mountains: 6, Ruins: 6, Water/River: 21, Woodland: 6 |
| Core tile pieces | 58 | Double-sided pieces: Basic face paired with Upgraded face. |
| Special tile pieces | 25 | One-sided tiles unlocked by Arrivals. |
| Encounter Cards | 80 | Arrival: 25, Boon: 25, Burden: 25, Golden Boon: 5 |
| Warehouse resources | TBD production quantity | Wood, Stone, Metal, Food, Herbs, Goods; prototype cap is 15 per resource. |
| Strain tokens | TBD production quantity | 3 Strain overstrains a tile; final token count not specified in JSON. |
| Arrival timer tokens | TBD production quantity | Arrivals start with 3; maximum 3. |
| Steward/player markers | TBD production quantity | Used to mark each player's Steward location on the map. |
| Supported markers | TBD production quantity | Used to mark manual or passive Supported state in prototype. |

Full tile and card component tables are in `docs/the_quiet_vale_component_list_tiles_and_cards.md`.

## Standard Setup

1. Choose 1-4 players.
2. Use Redesigned Basic Map v0.2 as the default locked map.
3. Each player chooses a unique Steward and takes that Steward's once-per-Season power from the start of the game. Steward House tiles are not used in this playtest version.
4. Place all directly placeable Core Basic tiles in the tile supply. Upgraded faces are not placed directly; they are used when tiles are upgraded.
5. Keep Special Tiles locked until their matching Arrival is completed.
6. Stock the shared Warehouse based on player count: 1 player starts with 15 of each resource, 2 players with 10 of each, 3 players with 5 of each, and 4 players with 0 of each. The 5+ Council Variant reference value is also 0 of each resource, but the prototype does not implement Council Variant.
7. Build a balanced standard Encounter pool with 5 Boons, 5 Burdens, and 5 Arrivals per player.
8. Shuffle the standard pool.
9. Deal 9 hidden Encounter Cards to each player.
10. Deal 3 standard Encounter Cards per player to the Encounter Deck.
11. Golden Boons are not currently supported by the online prototype. Do not add a Golden Boon during online prototype playtests.
12. Each player places their Steward token for free on its setup terrain. This costs 0 Actions and 0 resources, ignores normal adjacency, and must use an empty non-River hex.
13. Start at Round 1, Season I, Seasonal Seed Encounters phase. Each player seeds three hidden Encounter Cards: one to the top of the Encounter Deck, one to the middle, and one to the bottom. Each player has 4 Actions available for the round. There is no forced opening Resource tile; players choose their first normal tile action.

## Round And Season Structure

The game has 3 Seasons and 12 total rounds.

- Season I: Rounds 1-4.
- Season II: Rounds 5-8.
- Season III: Rounds 9-12.

Season-start rounds follow this order. Season-start rounds are Round 1, Round 5, and Round 9.

1. Seasonal Seed Encounter Cards.
2. Reveal Encounters.
3. Player Turns.
4. End of Round.

All other rounds skip Seasonal Seed Encounter Cards and begin with Reveal Encounters.

At the start of Round 5 and Round 9, unresolved active Burdens reapply using the new Season's text.

## Seed Encounters

Seasonal Seed Encounters happens only at the start of each Season: Round 1, Round 5, and Round 9.

During Seasonal Seed Encounters, each player chooses 3 hidden Encounter Cards from their hand if able:

- 1 card seeded to the top of the Encounter Deck.
- 1 card seeded to the middle of the Encounter Deck.
- 1 card seeded to the bottom of the Encounter Deck.

After Seasonal Seed Encounters, proceed to Reveal Encounters.

No Encounter Cards are seeded during non-season-start rounds. A season-start round can seed Encounter Cards only once.

## Reveal Encounters

During Reveal Encounters, reveal standard Encounter Cards equal to the player count.

Golden Boon online prototype note:

- Golden Boons are not currently supported by the online prototype.
- Reveal standard Encounter Cards only during online prototype playtests.

Encounter types:

- Boon: resolve the current Season effect. If the effect modifies a future action, keep it visible until used or expired by its text.
- Burden: apply the current Season effect, then place the card as an active Burden unless the card's resolution lifecycle says otherwise.
- Arrival: place it as an active Arrival with 3 timer tokens.
- Golden Boon: not currently supported by the online prototype.

A round can reveal Encounters only once.

## Player Turns And Actions

During Player Turns, each player receives 4 Actions for the round.

Implemented action types:

- Place a Tile.
- Upgrade a Tile.
- Activate a Tile.
- Complete an Arrival.
- Resolve a Burden.
- Use a Steward Power.

If a player ends their turn with unspent Actions, those Actions are not carried forward by the prototype; the next player becomes active. When the final player ends their turn, the round moves to End of Round.

## Map, Terrain, And River

Use Redesigned Basic Map v0.2 as the default locked flat-top hex map.

Map facts from JSON:

- Hexes: 126.
- Coordinate convention: columns A-N left to right, rows 1-9 top to bottom.
- Terrain counts: Arable Land: 6, Grasslands: 75, Heaths: 6, Mountains: 6, Ruins: 6, Water/River: 21, Woodland: 6.
- Water/River hexes: D1, D2, E3, F3, E4, G4, H4, E5, I5, J5, E6, K6, L6, E7, L7, E8, F8, M8, N8, G9, H9.
- Every Water/River hex is a legal potential Bridge placement site.
- Bridge Candidate markers are optional review/test annotations only, not placement restrictions.

Map rules:

- Use flat-top hex adjacency only.
- No tile may be placed on a River/Water hex unless the tile explicitly permits Water/River placement.
- Bridge is the normal tile placed on a Water/River hex and is a Travel Tile.
- Placed, non-Overstrained tiles adjacent to a Bridge connect through that Bridge, including across the river.
- An Overstrained Bridge loses Travel connectivity.
- Docks and Washhouse/Bathhouse-style tiles follow their printed Water terrain placement text.
- Crossing the river without a Bridge connection costs 1 Action.

## Tile Placement

To place a tile:

1. Choose a tile that is available in the supply.
2. Choose a legal empty footprint on the approved map.
3. Pay the tile's resource cost from the shared Warehouse.
4. Spend the Place action cost.
5. The tile must be reachable from the acting Steward's connected settlement network unless a Steward power or card explicitly says otherwise.
6. Place the tile and reduce its available stock.
7. Move the acting player's Steward marker to the placed tile.

A tile must obey its printed placement rule, including terrain and adjacency restrictions. Multihex tiles must keep their full footprint on legal empty hexes. Single-hex tiles do not require rotation.

## Connected Settlement Network And Steward Location

All placed, non-Overstrained tiles create the connected settlement network when connected by flat-top adjacency. Travel Tiles remain a tile category and component identity, but they are no longer the only tiles that carry reachability. Active Bridges and eligible Docks can connect networks according to their rules.

For action purposes, the acting player's current Steward tile anchors that player's local access. This means:

- Players must place, upgrade, and activate tiles on the acting Steward's connected settlement network.
- After a placement, upgrade, or activation, the Steward marker moves to that tile.
- The Ranger Steward may travel anywhere once per Season for free before taking a map action. This does not spend an Action. In Season I, Ranger may use this power one additional time.

Overstrained tiles do not contribute to the connected settlement network.

## Tile Upgrade

To upgrade a tile:

1. Choose a placed tile with a matching Upgraded face.
2. The tile must not be Overstrained.
3. Pay the listed upgrade resource cost, if any.
4. Spend the Upgrade action cost.
5. The tile must be reachable from the acting Steward's connected settlement network unless a Steward power or card explicitly says otherwise.
6. Replace the placed tile's Basic face with its Upgraded face while preserving its map position and state.
7. Move the acting player's Steward marker to that tile.

Resource tile upgrades cost only the Upgrade action when their source cost is 0.

## Tile Activation

To activate a tile:

1. Choose a placed tile with a supported activation effect.
2. The tile must not be Overstrained.
3. Spend the Activate action cost.
4. The tile must be reachable from the acting Steward's connected settlement network unless a Steward power or card explicitly says otherwise.
5. Resolve the tile's printed effect.
6. Move the acting player's Steward marker to that tile.

Activation effects currently represented in the source include production, Strain removal, Arrival timer support, resource exchange, active Burden resolution, Encounter deck inspection, and giving Supported to adjacent eligible tiles.

## Warehouse And Resources

The shared Warehouse stores: Wood, Stone, Metal, Food, Herbs, Goods.

The prototype uses a cap of 15 per resource unless a rule explicitly changes that cap. Costs are paid from the shared Warehouse. Gains cannot exceed the cap.

## Strain, Supported, And Overstrained

Strain represents pressure on placed tiles.

- A tile with 3 Strain is Overstrained.
- Overstrained tiles cannot activate or upgrade.
- Overstrained tiles do not provide passive effects.
- Overstrained tiles do not contribute Population or Renown to final scoring.
- Overstrained tiles do not contribute to the connected settlement network or provide Travel-specific benefits.
- Overstrained tiles cannot receive more Strain.

Supported prevents the first Strain placed on a tile each round. Supported use resets at end of round.

Support tile balance update: broad adjacent Supported effects now require activation. Basic support tiles give Supported to 1 adjacent eligible tile. Upgraded support tiles give Supported to up to 2 adjacent eligible tiles. Brewery of Legends and Labourers' Yard apply their adjacent placement discount once per Season, not once per round.

## Burdens

When a Burden is revealed:

1. Apply the current Season effect.
2. If the Burden has a supported reveal choice, resolve or record that choice.
3. Place the card as an active Burden unless its text says otherwise.

Burdens that place Strain can affect disconnected or unreachable tiles unless the card says otherwise. If fewer valid targets exist than requested, choose all valid targets. If no valid targets exist, no Strain is placed, but the Burden remains active unless resolved.

Some Burdens have no normal Season I or Season II resolution, but the current balance pass gives previously unresolvable Burdens a Season III resolution opportunity where printed.

## Resolving Burdens

If a Burden has a supported resolution cost, a player may resolve it by paying the listed requirement and spending the listed action cost. Resolved Burdens leave active play and do not reapply at future Season starts.

Some Steward powers and Boons can reduce Burden resolution action or resource costs.

## Arrivals

When an Arrival is revealed:

1. Place it as an active Arrival.
2. Give it 3 timer tokens.
3. Timer tokens cannot exceed 3.

To complete an Arrival:

1. Fulfill its requirement all at once.
2. Spend 1 Action to complete it.
3. Pay any required resources.
4. Move the Arrival to completed state.
5. Unlock its matching Special Tile.

At end of round, remove 1 timer token from each active Arrival. Failed Arrivals with no remaining timer tokens expire, then the group adds 1 Strain to any placed tile of their choice.

Arrival and Special Tile links from JSON:

| Arrival | Requirement | Reward | Unlocked Special Tile |
| --- | --- | --- | --- |
| Acorns and Oak Trees | 6 Herbs<br>6 Stone<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Shrine of Renewal | Shrine of Renewal |
| Blessed Harvest | 6 Food<br>6 Stone<br>within three rounds. Place three tokens on this card to track. | Unlock Shrine of Bounty | Shrine of Bounty |
| From Battle to Cattle | 2 Wood<br>2 Stone<br>6 Food<br>within three rounds. Place three tokens on this card to track. | Unlock The Tamers' Respite | The Tamers' Respite |
| From Blade Swingers to Herb Stringers | 2 Wood<br>2 Stone<br>6 Food<br>within three rounds. Place three tokens on this card to track. | Unlock The Root Weavers Respite | The Root Weavers Respite |
| From Dark Decay to Light Display | 2 Wood<br>2 Stone<br>6 Food<br>within three rounds. Place three tokens on this card to track. | Unlock The Lorekeepers' Respite | The Lorekeepers' Respite |
| From Plunderer to Lumber | 2 Wood<br>2 Stone<br>6 Food<br>within three rounds. Place three tokens on this card to track. | Unlock The Reavers' Respite | The Reavers' Respite |
| From Songs of War to the Search for Ore | 2 Wood<br>2 Stone<br>6 Food<br>within three rounds. Place three tokens on this card to track. | Unlock The Iron Roots Respite | The Iron Roots Respite |
| Hands for Heavy Work | 4 Food<br>4 Stone<br>4 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Labourers’ Yard | Labourers’ Yard |
| Lanterns for the Long Roads | 4 Wood<br>4 Metal<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Lantern Roadhouse | Lantern Roadhouse |
| Lay down the tools of destruction | 2 Metal<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Reliquary | Reliquary |
| Lest we forget | 4 Wood<br>4 Metal<br>within three rounds. Place three tokens on this card to track. | Unlock Theater | Theater |
| Moving Mountains | 6 Food<br>6 Stone<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Shrine of Depths | Shrine of Depths |
| News travels faster than goods | 5 Food<br>5 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock The Waystation | The Waystation |
| No soul shall go without | 2 Goods<br>2 Herbs<br>within three rounds. Place three tokens on this card to track. | Unlock Alms House | Alms House |
| Reablement for the Realm | 4 Wood<br>4 Metal<br>within three rounds. Place three tokens on this card to track. | Unlock Atelier Workshop | Atelier Workshop |
| Remnants of the Cavalry | 2 Wood<br>4 Herbs<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Stables x 2 | Stables |
| Remnants of the Fleet | 2 Wood<br>4 Herbs<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Docks | Docks |
| Spirit-Lifting Spirit | 8 Wood<br>4 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Brewery of Legends | Brewery of Legends |
| Strong foundations | 2 Goods<br>2 Herbs<br>within three rounds. Place three tokens on this card to track. | Unlock House of Learning | House of Learning |
| The Burden-Bearers | Have at least 1 Housing Tile and pay 2 Herbs and 2 Goods.<br>within three rounds. Place three tokens on this card to track. | Unlock The Resting Hall | The Resting Hall |
| The Dryads | 6 Herbs<br>6 Stone<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Shrine of Ancients | Shrine of Ancients |
| The Hearthbound Circle | 6 Herbs<br>4 Food<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Hearth Garden | Hearth Garden |
| The Quiet Quest | 4 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Adventurers' Guild | Adventurers' Guild |
| The transmutation traveler | 2 Herbs<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Alchemist's Workshop | Alchemist's Workshop |
| What came before the last age | 6 Stone<br>6 Metal<br>2 Goods<br>within three rounds. Place three tokens on this card to track. | Unlock Shrine of Ancestors | Shrine of Ancestors |

## Golden Boons

Golden Boons are special Encounter Cards in the design set, but they are not currently supported by the online prototype. Do not add them to the Encounter Deck during online prototype playtests.

## Stewards And Steward Powers

Steward tokens are placed for free during setup before Encounter cards are seeded. Steward House tiles are not used in this playtest version. Each Steward has their once-per-Season power from the start of the game. Only the matching Steward may use their own power, even though all Stewards may use the shared connected settlement network.

Setup terrain:

- Vanguard: Woodland.
- Knight: Arable Land.
- Sentinel: Mountains.
- Ranger: Heaths.
- Warden: Ruins.
- Quartermaster: Woodland, Mountains, Heaths, Arable Land, or Ruins; not Grasslands or River.

Current Steward powers:

- Vanguard: once per Season, reduce an eligible Travel or Resource placement cost by 2 resources, to a minimum of 0.
- Knight: once per Season, eligible Housing placement costs 0 Actions.
- Sentinel: once per Season, eligible Core upgrade costs 0 Actions.
- Ranger: once per Season, travel to anywhere for free before taking a map action. This does not spend an Action. In Season I, Ranger may use this power one additional time.
- Quartermaster: once per Season, exchange up to 3 Warehouse resources. In addition, once during Season I, exchange up to 2 Warehouse resources.
- Warden: once per Season, resolve an active Burden without spending an Action.

Each Steward also has an end-game objective worth 15 Renown if fulfilled. Warden's objective is fulfilled if active Burdens are fewer than the player count.

## End Of Round

At End of Round:

1. Remove 1 timer token from each active Arrival.
2. Expire failed Arrivals with no timer tokens remaining, then add 1 Strain to any placed tile of the group's choice for each expired Arrival.
3. Discard Boons that expire at end of round.
4. Reset per-round Supported use.
5. Advance to the next round, or complete the game after Round 12.

At the end of Season I after Round 4, and Season II after Round 8, each Overstrained tile spreads 1 Strain to an adjacent tile where possible.

At the start of Rounds 5 and 9, unresolved active Burdens reapply using the new Season's text.

## Final Scoring

At game end:

1. Add Population from non-Overstrained placed tiles.
2. Add Renown from non-Overstrained placed tiles.
3. Add 15 Renown for each fulfilled Steward objective.
4. Subtract 6 Renown for each unresolved active Burden.
5. Subtract 2 Renown for each Strain token on the board.

Final score = Population + Renown - active Burden penalties - Strain penalties.

## Production Notes To Resolve

These items are not final production rules yet, but matter before finished documents:

- Confirm exact final seeding wording and deck insertion method.
- Confirm physical token quantities for resources, Strain, timers, Supported markers, and Steward/player markers.
- Run final copy-editing on all card-facing text.
- Confirm whether the prototype's last-interaction marker language should become final Steward Token language or remain a prototype abstraction.
- Confirm final component naming for the map board and any player aids.
