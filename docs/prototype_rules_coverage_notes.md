# Prototype Rules Coverage Notes

This note tracks the local prototype as of the v2.0 aligned production-set pass. It is a working robustness checklist, not final rules documentation.

## Supported Now

- Loads the JSON map, tiles, encounter cards, and rules config from `src/data/`.
- Uses `Redesigned Basic Map v0.2` as the default locked map; `Redesigned Basic Map v0.1` remains available as the previous reference map.
- Provides a setup `Redeal Cards` control for generating a fresh playtest seed and rebuilding Encounter hands/deck without changing map or player count.
- Stocks the starting Warehouse by player count: 15 of each resource at 1p, 10 at 2p, 5 at 3p, and 0 at 4p/5+ Council reference.
- Renders the current flat-top hex map with terrain, features, placed tiles, Strain, Support, and player last-interaction markers.
- Places, upgrades, activates, strains, supports, and overstrains local tiles through the prototype controls.
- Applies disconnected Travel action costs to placement, activation, and upgrade actions on tiles away from the connected settlement network.
- Builds connected settlement networks from all placed, non-Overstrained tiles while keeping printed Travel Tile identity for Travel-specific effects.
- Counts every hex in a multihex tile footprint when checking connected settlement adjacency and disconnected placement costs.
- Handles local Encounter setup, debug seeding, reveal, active Arrivals, active Burdens, active Boons, and end-of-round/end-of-season flow.
- Shows source text for Encounter cards and tiles so testing can compare the rule text against the implemented behavior.
- Implements v2.2 Core Resource production values, Workshop/Makers Conclave upgrade support, Market/Seldes Goods substitution, and The Apprentice Steward as a placement Action discount rather than a resource discount.
- Shows Encounter flavour text prominently on active Encounter cards, recent reveals, and round effects so playtests can read the settlement story while checking mechanics.
- Shows a debug Encounter coverage audit for each source Encounter card, including supported, partial, and unsupported implementation status.
- Provides a sticky prototype testing bar for phase, player actions, steward marker context, latest action result, panel jumps, and common turn-flow actions.
- Prioritizes the playtest layout around the map, Warehouse, tile placement, selected tile actions, and Encounter cards before lower-priority debug and feedback tools.
- Provides prototype map shortcuts: right-click an empty hex to rotate a selected multihex placement preview, and right-click a placed tile to open quick Produce/Interact and Upgrade actions.
- Provides debug scenario presets for focused local checks of disconnected Travel, Steward marker travel anchoring, Arrival completion, Burden resolution, Boon discounts, Supported Strain, and Golden Vial travel.
- Shows a Playtest Pulse panel with action mix, travel friction, Encounter pressure, board Strain, resource caps, and pacing signals for subjective playtesting.
- Provides Playtest Notes and a generated markdown report for capturing subjective fun, pacing, tension, choice quality, friction, balance notes, and rule questions.
- Treats source Burdens without `To resolve:` text as persistent active Burdens; they reapply at Season starts and cannot be resolved by the player.
- Implements `The Golden Bell` as a deterministic prototype choice from eligible game-box Arrivals, revealing one as an active Arrival with 3 timer tokens.
- Implements `The Golden Eyed Traveler` as one additional Player Turns phase before end-of-round effects.
- Implements `The Golden Scroll` as a pending hand-refresh choice that discards selected standard hand cards and draws replacements from eligible game-box standards.
- Implements `The Golden Signet Ring` as a pending relocation choice for up to 5 placed tiles, preserving tile state while enforcing empty final footprints and terrain/river restrictions.
- Implements `The Golden Vial` as a rest-of-game, once-per-round discount for the disconnected Travel action cost.
- Supports player last-interaction markers as the local stand-in for Steward Tokens.
- Counts the acting player's last-interaction marker as the local travel anchor for disconnected Travel action costs.
- Implements `The Burden of Command` and `Where Help Stands` against those markers.
- Provides debug controls to manually set or clear each player's marker.
- Implements minimal upgraded Steward House powers:
  - Vanguard Home: once per Season, eligible Travel/Resource placement costs 0 Actions.
  - Knight Home: once per Season, eligible Housing placement costs 0 Actions.
  - Sentinel Home: once per Season, eligible Core upgrade costs 0 Actions.
  - Ranger Home: once per Season, disconnected placement can ignore the extra Travel action.
  - Quartermaster Home: once per Season, exchange up to 3 Warehouse resources.
  - Warden Home: once per Season, resolve an active Burden without spending an Action.

## Intentionally Rough

- Steward Tokens are represented by each player's last interacted tile, with debug override controls for testing.
- Steward House powers use plain selectors and buttons; this is not final UI.
- Card and tile text display is a testing aid, not final presentation.
- The larger Encounter Board is a readability pass for prototype playtesting, not final card layout or visual design.
- The sticky testing bar and collapsible debug panels are usability aids for the local prototype, not final visual design.
- The playtest-first layout is provisional and intended to reduce scrolling during local feel tests.
- Debug scenario presets deliberately reset the local game to focused 1-player testing states.
- Playtest Pulse signals are prompts for feel and pacing discussion, not balance verdicts.
- Playtest Notes are local browser-state helpers; they are not permanent saved campaigns or final production playtest forms.
- Encounter card support is still incremental. The coverage audit is a testing aid, not final presentation or a promise that every partial card is fully resolved.
- Multihex placement and rotation are prototype controls. Single-hex tiles do not need rotation.

## Robustness Checks To Keep Running

- Full automated suite after each rules pass: `node --test tests/*.test.js` or `npm test` where npm is available.
- Prototype smoke flow: `node --test tests/prototype-smoke.test.js`.
- Browser smoke after interface changes: load the local app, confirm no page errors, and verify key panels are visible.
- Test each new Encounter against the source card text with at least one positive case and one invalid-choice case where useful.
- Test once-per-round and once-per-Season effects for both first use and blocked repeat use.
- Test overstrained providers, because many effects should stop working when the source tile is overstrained.
- Test resource choice effects with repeated resources, invalid resources, not enough Warehouse resources, and exact-count requirements.

## Good Time For Deeper Bug Testing

The next good robustness pass is after the remaining common Encounter templates are implemented and before adding any larger presentation layer. At that point, the rules surface will be broad enough that edge cases matter, but still small enough to fix without untangling final UI assumptions.
